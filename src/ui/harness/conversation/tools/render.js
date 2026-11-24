// @ts-check
// The tool renderers: one row per hand through the shared layout, and groups formed from
// consecutive completed stubs of one family (Explore, Changes, Terminal). A card shows only what the events
// carried — chars and ms as facts, the command the call was given, never output or a diff that was not computed.
// The Appearance switches reach in here: the three group toggles and "Show todos".
import { h, morph, morphChildren, on, placeChildren, setHtml, standing } from "../../../lib/dom.js";
import { prefs } from "../../prefs.js";
import { ICONS } from "../../lib/icons.js";
import { toolRow, fileChip, factsOf, statusOf, refusedWhy, chipActions } from "./layout.js";
import { endFromList } from "../../lib/subagents.js";
import { guestId } from "../../lib/guest-thread.js";
import { failureCard, failureWords } from "../../lib/failure.js";
import { inlineEditDiff, changeKnown, readWhenShown } from "../../lib/diff-render.js";
import { fmt } from "../../../lib/format.js";
import { mdChat } from "../../lib/md-stream.js";
import { callNamedIn, callRev, fillCalls, planBody } from "../../lib/labels.js";
import { attachedNames, attachedWords, handedWords } from "../../lib/agent-cards.js";
import { inlineMarks } from "../../widgets/kit.js";
import { pictureUrl, pictureThumb, pictureLost } from "../../lib/picture-view.js";
import { askedCardRow, askedCardAgain, drewPart, madePart } from "../agent-card.js";
import { followStore } from "../subagent-marks.js";
import { ticking } from "../turn.js";
import { chatLinkEl } from "../../lib/chat-open.js";
import { nextFrame } from "../../lib/weak-frame.js";
import { proposedOf, routineCard } from "../routine-card.js";

/** @typedef {{ chain: string, n: number, agent?: string, there?: import("./layout.js").There | null }} TurnAt  a turn's
 *  chat and number (an agent's thread: its exchange's, and `agent`, the agent): where its edit cards ask their call's
 *  own change (HarnessV4_Four_Plan E22). `there`: an agent's on another machine, whose calls ran there — its changes,
 *  files and pictures are that machine's, and its cards ask nothing of this one's */

/** The grouping switches, as groupRuns reads them. */
function groupToggles() {
  return {
    explore: prefs.get("groupExplore") !== false,
    terminal: prefs.get("groupTerminal") !== false,
    changes: prefs.get("groupChanges") !== false,
  };
}

/** The family a call belongs to, for grouping. Null means it never groups. The card's kind decides (D8: any
 *  vocabulary speaks it); the name is the fallback for older events that carry no card. Takes a stub or its name.
 *  @param {any} t */
export function familyOf(t) {
  const kind = t && typeof t === "object" ? t.card?.kind : null;
  if (kind) {
    if (kind === "read" || kind === "search" || kind === "list") return "explore";
    if (kind === "write" || kind === "edit") return "changes";
    if (kind === "shell") return "terminal";
    return null;
  }
  const n = String(typeof t === "string" ? t : t?.name || "").toLowerCase();
  if (n === "read" || n === "glob" || n === "grep") return "explore";
  if (n === "write" || n === "edit") return "changes";
  if (n === "bash" || n === "bash_background" || n === "bash_output" || n === "bash_kill" || n === "powershell") return "terminal";
  return null;
}

/**
 * A file's errors as a write's or an edit's card lists them: each at its line and column, then its words — the lines
 * as the lsp tool says them (`path:line:column: error: words`) — and how many more there are past those it carries.
 * @param {{ errors: number, lines?: unknown }} lsp
 */
export function lspErrors(lsp) {
  const lines = Array.isArray(lsp.lines) ? lsp.lines.map(String) : [];
  return h("ul", { class: "lsp-errors" },
    lines.map((l) => {
      const m = /^.+?:(\d+):(\d+): error: ([\s\S]*)$/.exec(l);
      return h("li", {}, m ? [h("span", { class: "lsp-at" }, `${m[1]}:${m[2]}`), m[3]] : l);
    }),
    lsp.errors > lines.length ? h("li", { class: "lsp-more" }, `${fmt.n(lsp.errors - lines.length)} more`) : null);
}

/**
 * A result preview. It is the head of what the model was given, never the whole result — the Prompt action is where
 * that lives. A cut the backend marked stays visible, so a short preview is never mistaken for a short result.
 * @param {any} t
 */
function previewBody(t) {
  return h("div", { class: "term-card" }, ...previewParts(t));
}
/** A result preview's parts, for a body that shows more beside it. @param {any} t */
function previewParts(t) {
  const clipped = t.chars != null && String(t.preview).length < t.chars;
  return [
    // `data-result`: the card draws its result here, so an archived one reads it whole as it opens (`wholeResult`).
    h("pre", { class: "term-out", "data-result": "" }, t.preview),
    clipped ? h("p", { class: "pane-note" }, `Preview of ${t.chars} characters. The whole result is in the request.`) : null,
  ];
}

/**
 * What a memory tool was given and what it returned, under its pill (the owner's of 10-28: "when memory tool is used
 * i should be able to click that chip or pill and it should expand and show the content of that tool output", and
 * "maybe for memory tool i could see both input and output"): the words it was given where its row cuts them, the
 * rest of its input in a line, then its result — a whole JSON answer laid out, else as it came, a cut one said so.
 * @param {any} t @param {{ asked: string, given: string }} ask
 */
function memoryBody(t, { asked, given }) {
  const raw = String(t.preview || "");
  let text = raw;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === "object") text = JSON.stringify(j, null, 2);
  } catch { /* a cut or plain answer: as it came */ }
  const clipped = t.chars != null && raw.length < t.chars;
  return h("div", { class: "term-card" },
    asked.trim() && line(asked) !== asked.trim() ? h("pre", { class: "term-cmd mem-asked" }, asked) : null,
    given ? h("p", { class: "pane-note mem-given" }, given) : null,
    raw ? h("pre", { class: `term-out${t.state === "failed" ? " fail" : ""}`, "data-result": "" }, text) : null,
    clipped ? h("p", { class: "pane-note" }, `Preview of ${t.chars} characters. The whole result is in the request.`) : null);
}

/**
 * The rest of a memory call's input, past the words its row names, in one line ("kind: procedure · reason: …"): an
 * archived call's, whose input the transcript kept. @param {Record<string, any>} a @param {string | undefined} key
 */
const givenWords = (a, key) =>
  Object.entries(a)
    .filter(([k, v]) => k !== key && v != null && v !== "")
    .map(([k, v]) => `${k}: ${line(typeof v === "string" ? v : JSON.stringify(v))}`)
    .join(" · ");

/** The first line of an arg, clipped. @param {any} v */
const line = (v) => {
  const s = String(v || "").split("\n")[0].trim();
  return s.length > 80 ? s.slice(0, 79) + "…" : s;
};

/** The loop sends args as one clipped string (argSummary); each hand's string has a shape, read back here.
 *  An object is used as-is for tests and any caller that already parsed it. @param {any} t */
function argsOf(t) {
  if (t.name === "bash_output" || t.name === "bash_kill") {
    const m = /bg_[0-9a-z]+/.exec(String(t.args || ""));
    return m ? { id: m[0] } : {};
  }
  const a = t.args;
  if (a && typeof a === "object") return a;
  const s = String(a || "");
  const name = String(t.name || "").toLowerCase();
  // A memory tool's summary is what it looks for or keeps (agent/tools.js argSummary).
  if (name.startsWith("filament_memory")) return { query: s };
  if (name === "grep" || name === "glob") {
    const m = /^(.*?)(?: in (.*))?$/.exec(s);
    return { pattern: m?.[1] || s, path: m?.[2] || "" };
  }
  if (name === "delegate_read" || name === "task") {
    const m = /^\d+ files: (.*)$/.exec(s);
    return { brief: m?.[1] || s };
  }
  if (name === "agent") return { brief: s };
  if (name === "ask") return { question: s };
  // The envelope tool's summary (agent/envelopes.js `envelopeSummary`), a coding agent's call of it over Filament's MCP
  // server too: a letter or an answer to one, "all", a count, or none — the oldest — or a picture by its name
  // (HarnessV4_DesignPass_Plan UX1); else its input as JSON, read as it is.
  if (name === "envelope" || name.endsWith("__envelope")) {
    if (s.startsWith("picture ")) return { picture: s.slice(8) };
    // A letter to another chat, or an answer to one (app/letters.js): "letter to <chat>: <subject>", "answer <id>".
    const letter = /^letter to (.+?)(?:: (.*))?$/.exec(s);
    if (letter) return { to: letter[1], subject: letter[2] || "" };
    if (s.startsWith("answer ")) return { answer: s.slice(7) };
    if (s === "all") return { all: true };
    if (/^\d+$/.test(s)) return { count: Number(s) };
    try {
      const j = JSON.parse(s);
      return j && typeof j === "object" ? j : {};
    } catch {
      return {};
    }
  }
  if (name === "bash" || name === "powershell") return { command: s };
  // The language server's summary is its card's subject, which the row names already: no path of its own.
  if (name === "lsp") return {};
  return { path: s, command: s };
}

/** Open state remembered per tool id for the session — a rebuild mints fresh records, so the id is the key. */
const openState = new Map();

/**
 * The rows a caller drew last, kept where it keeps them (`o.drawn`: the timeline's, one per turn). A running turn's
 * cards are drawn again on every run event, and a call whose record did not change keeps the row it has: drawn anew,
 * its picture shrank to its placeholder and grew back, and its diff and its output's end came a moment later, so the
 * turn's work flickered at every call (the owner's words of 10-18). A sub-agent's card reads the session's list as
 * well: it is kept while that row says the same, and while nothing its run's events said of it moved (its `rev`,
 * labels.js) — drawn again at every frame, a long turn's cards were its frames' heaviest work (the performance
 * Hunter's find of 10-25). A card of a saved agent the main agent asked reads its marks and answers too, and is drawn
 * again each time.
 * @typedef {Map<string, { sig: string, row: HTMLElement, quick?: string | null }>} DrawnRows
 */
/** What a call's row is drawn from: its record as the run's events left it, and the options that reach its card.
 *  @param {any} t @param {{ runId?: string, round?: number | null, turnAt?: TurnAt | null, moveRun?: string | null, onPrompt?: any, live?: boolean }} o */
const rowSig = (t, o) => JSON.stringify([t, o.runId ?? null, o.round ?? null, o.turnAt ?? null, o.moveRun ?? null, !!o.onPrompt, !!o.live]);
/** What reaches a call's card besides its record; whether its turn runs (`live`), which holds a long command's card open. @param {{ runId?: string, round?: number | null, turnAt?: TurnAt | null, moveRun?: string | null, onPrompt?: any, live?: boolean }} o */
const optsSig = (o) => JSON.stringify([o.runId ?? null, o.round ?? null, o.turnAt ?? null, o.moveRun ?? null, !!o.onPrompt, !!o.live]);
/**
 * A call's row kept while it holds: first by how its alignment counts its moves (`quick`, labels.js `callRev`) — the
 * one read at every frame —, else by what it is drawn from read whole (`full`), asked only where another alignment
 * made the record (the turn's own log read again at its end), so a row whose call did not change is kept then too.
 * `full` null: drawn again whenever `quick` differs — into the row that stands (`drawInto`).
 * @param {DrawnRows | null | undefined} drawn @param {string} key @param {string | null} quick @param {(() => string) | null} full @param {() => HTMLElement} make
 */
function keptCall(drawn, key, quick, full, make) {
  const was = drawn?.get(key);
  if (was && quick && was.quick === quick) return was.row;
  const sig = full ? full() : null;
  if (was && sig != null && was.sig === sig) {
    was.quick = quick;
    return was.row;
  }
  const row = drawInto(was?.row, make);
  drawn?.set(key, { sig: sig ?? "", row, quick });
  return row;
}
/** A number for each drawing of a row — one made, or drawn again into the one that stands — so a group knows its rows
 *  as the same drawings: its line is drawn from their calls. */
const drawings = /** @type {WeakMap<HTMLElement, number>} */ (new WeakMap());
let drawCount = 0;
/** @param {HTMLElement} row */
const drawingOf = (row) => drawings.get(row) ?? (drawings.set(row, ++drawCount), drawCount);
/**
 * A row drawn again: what `make` drew, drawn into the row that stands for the same thing (dom.js `morph`), else the
 * one made. Made anew, a running command's row was a new element at each line of its output, and its Run in background
 * or the row itself under a resting pointer blinked and lost the press (the owner's of 11-01: "buttons … start
 * blinking … sometimes the clicks even don't pass through"). A maker that draws into the row that stands itself hands
 * that one back (`subagentRow`). Each drawing counts anew (`drawingOf`).
 * @param {HTMLElement | undefined} was @param {() => HTMLElement} make
 */
function drawInto(was, make) {
  const made = make();
  const row = was && was !== made ? morph(was, made) : made;
  drawings.set(row, ++drawCount);
  return row;
}

/**
 * The row `drawn` keeps under `key` while what it is drawn from (`sig`) holds, else one drawn again into it
 * (`drawInto`), kept. Exported for the timeline's own rows (a message the loop read, drawn among the cards).
 * @param {DrawnRows | null | undefined} drawn @param {string} key @param {string} sig @param {() => HTMLElement} make
 */
export function keptRow(drawn, key, sig, make) {
  const was = drawn?.get(key);
  if (was && was.sig === sig) return was.row;
  const row = drawInto(was?.row, make);
  drawn?.set(key, { sig, row });
  return row;
}
/** Each image card's picture, read once per call, the latest few kept: the read, and what it read once it has — a card
 *  drawn again draws that at once. */
const shots = /** @type {Map<string, { read: Promise<{ src: string, note: string }>, got?: { src: string, note: string } }>} */ (new Map());
const SHOTS_KEPT = 24;

/**
 * An image the agent made (Cursor's generateImage, Codex's image_generation): what it was asked to draw and, once it is
 * saved, its file — shown on the card, and opened whole in the side pane from its chip or the picture. One the files
 * route cannot show (outside the session's folder, too large, gone) is named by its chip and says why it is not shown.
 * One made on another machine (`there`) is that machine's file: none of this computer's is read for it.
 * @param {any} t @param {any} base @param {import("./layout.js").There | null} [there]
 */
function imageRow(t, base, there = null) {
  const running = t.state === "running";
  const file = typeof t.file === "string" ? t.file : "";
  const asked = line(t.card?.subject ?? argsOf(t).description ?? "");
  /** @param {{ src: string, note: string }} r */
  const shown = (r) => (r.src
    ? h("img", { class: "code-img", src: r.src, alt: asked || file, title: "Open it in the side pane", onclick: () => chipActions.open?.(file) })
    : h("p", { class: "pane-note" }, r.note));
  let held = null;
  if (file && there) held = { read: Promise.resolve({ src: "", note: `Not shown: the picture is on ${there.name}, where its chat shows it.` }), got: { src: "", note: `Not shown: the picture is on ${there.name}, where its chat shows it.` } };
  else if (file && chipActions.readFile) {
    held = shots.get(t.id);
    if (!held) {
      const read = Promise.resolve(chipActions.readFile?.(file)).then(
        (r) => (r?.kind === "image" && r.dataUrl ? { src: String(r.dataUrl), note: "" } : { src: "", note: r?.note ? `Not shown: ${r.note}.` : "Not shown: the file is not an image the viewer reads." }),
        () => ({ src: "", note: "Not shown: the file is outside this session's folder, or gone." }));
      const entry = /** @type {{ read: typeof read, got?: { src: string, note: string } }} */ ({ read });
      read.then((r) => { entry.got = r; });
      held = entry;
      shots.set(t.id, entry);
      if (shots.size > SHOTS_KEPT) shots.delete(shots.keys().next().value ?? "");
    }
  }
  // Read already, the picture is drawn with its card; else it lands in the box that stands for this one once read.
  const got = held?.got;
  const shot = held ? h("div", { class: "image-shot", ...(got ? {} : { "data-placed": "" }) }, got ? shown(got) : null) : null;
  if (shot && held && !got) held.read.then((r) => standing(shot).replaceChildren(shown(r)));
  return toolRow({
    ...base,
    icon: ICONS.image,
    kind: running ? "Generating an image" : t.state === "failed" ? "Image failed" : "Generated an image",
    primary: file ? [fileChip(file, there)] : asked ? [asked] : [],
    secondary: [file ? asked : "", factsOf(t)].filter(Boolean).join(" · "),
    body: shot ? h("div", { class: "term-card image-card" }, shot) : undefined,
    open: !!shot,
  });
}

/**
 * One kept picture's thumbnail (HarnessV4_Tasks U9), served by Filament (picture-view.js `pictureThumb`), the `i`th of
 * `list` (`shown`), which the viewer steps through.
 * @param {string} ref @param {string} alt @param {(img: HTMLElement) => void} onGone
 * @param {{ src: string, alt: string }[]} [list] @param {number} [i]
 */
const thumb = (ref, alt, onGone, list = [], i = 0) => pictureThumb(pictureUrl(ref), alt, onGone, list.length > 1 ? { list, at: i } : null);

/** The pictures as the viewer steps through them, made once for all their thumbnails. @param {{ ref: string, alt: string }[]} pics */
const shown = (pics) => pics.map((p) => ({ src: pictureUrl(p.ref), alt: p.alt }));

/**
 * The pictures a call handed its model (HarnessV4_Tasks U9): thumbnails Filament serves, a click opening one whole over
 * the page. One no longer kept says so in its place, and any the run log could not keep are counted, with why. A call
 * on another machine's (`there`) were kept there: said so, none asked of this one.
 * @param {any} t @param {string} alt @param {import("./layout.js").There | null} [there]
 */
function picturesPart(t, alt, there = null) {
  const kept = Array.isArray(t.images) ? t.images : [];
  const lost = t.imagesNotKept && Number(t.imagesNotKept.count) > 0 ? t.imagesNotKept : null;
  if (!kept.length && !lost) return null;
  if (there) return h("div", { class: "tool-shots-wrap" }, h("p", { class: "pane-note" }, `${kept.length || lost?.count} picture${(kept.length || lost?.count) === 1 ? "" : "s"} it was shown, on ${there.name}: its chat there shows ${(kept.length || lost?.count) === 1 ? "it" : "them"}.`));
  const swept = kept.some((/** @type {any} */ im) => pictureLost(pictureUrl(String(im?.ref || ""))));
  const gone = kept.length ? h("p", { class: `pane-note${swept ? "" : " hidden"}` }, "No longer kept: a picture is kept as long as its run's log.") : null;
  const list = shown(kept.map((/** @type {any} */ im) => ({ ref: String(im?.ref || ""), alt })));
  return h("div", { class: "tool-shots-wrap" },
    kept.length
      ? h("div", { class: kept.length > 1 ? "tool-shots many" : "tool-shots" },
          ...kept.map((/** @type {any} */ im, /** @type {number} */ i) => thumb(String(im?.ref || ""), alt, (img) => {
            img.classList.add("gone");
            if (gone) standing(gone).classList.remove("hidden");
          }, list, i)))
      : null,
    gone,
    lost ? h("p", { class: "pane-note" }, `${lost.count} picture${lost.count === 1 ? " was" : "s were"} not kept: ${lost.why}.`) : null);
}

/** A kept picture's type and size, in the words of the loop's read (core/media.js `sizeWords`): "PNG image, 55 KB" —
 *  its type in the server's words (`label`, services/run-images.js). @param {any} im */
function pictureFacts(im) {
  const kind = im?.label ? String(im.label) : "Picture";
  const b = Number(im?.bytes) || 0;
  return `${kind} image, ${b < 1024 ? `${b} bytes` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`}`;
}

/** A call's pictures are named as its card names its subject: a read's file, a fetch's address, a tool's subject or
 *  its title. @param {any} t */
function pictureAltOf(t) {
  const subj = t.card?.subject != null ? String(t.card.subject) : null;
  const k = kindOfStub(t);
  if (k === "read") return String(subj ?? argsOf(t).path ?? "");
  if (k === "web") return line(subj || t.card?.title || "");
  const title = t.card?.title || t.name || "tool";
  return subj && subj !== title ? line(subj) : title;
}

/**
 * The pictures a turn's calls handed their model, in the order the calls ran — a sub-agent's after the call that
 * launched it — each named as its card names it (HarnessV4_Tasks U9). @param {any} aligned
 * @returns {{ ref: string, alt: string }[]}
 */
export function turnPictures(aligned) {
  /** @type {{ ref: string, alt: string }[]} */
  const out = [];
  /** @param {any} holder */
  const walk = (holder) => {
    for (const id of holder?.order || []) {
      const t = holder.tools?.get?.(id);
      if (!t) continue;
      for (const im of Array.isArray(t.images) ? t.images : []) if (im?.ref) out.push({ ref: String(im.ref), alt: pictureAltOf(t) });
      if (t.sub) walk(t.sub);
    }
  };
  for (const [, cell] of [...(aligned?.byRound?.entries?.() || [])].sort((x, y) => x[0] - y[0])) walk(cell);
  return out;
}

/**
 * A turn's pictures under its folded work (HarnessV4_Tasks U9): its work folds, what the agent saw stays in view —
 * every one, in one row that scrolls sideways, the newest in view (timeline.js `paintShots`), each opening whole in a
 * viewer that steps through them all. Its newest five stood alone, the rest behind a button that opened the turn's
 * first fold: one turn showed 5 of its 90 (the owner's of 11-05). Hidden once every fold of the turn is open
 * (harness.css, timeline.js `showCopies`): the cards show them there.
 * @param {{ ref: string, alt: string }[]} pics
 */
export function pictureStrip(pics) {
  const list = shown(pics);
  /** @type {HTMLElement} */
  const strip = h("div", { class: "work-shots", role: "group", "aria-label": `${pics.length} picture${pics.length === 1 ? "" : "s"} this turn's tools handed the agent` },
    ...pics.map((p, i) => thumb(p.ref, p.alt, (img) => {
      // A picture swept leaves the strip; the card in the fold says it is no longer kept.
      img.remove();
      if (!strip.querySelector("img")) strip.classList.add("hidden");
    }, list, i)));
  return strip;
}

/** The hits a search or listing result shows: its lines, less the hand's own words — "(no matches)", a notice in
 *  brackets, glob's "N paths limit reached", the -- between groups — and the backend's clip marker; a search's context
 *  lines (path-line-text, the lines around a match, HarnessV3-Tools TL-D8) are not hits either. Exported for the
 *  DOM-free pin.
 *  @param {string | undefined} preview @param {boolean} listing */
export function searchHits(preview, listing) {
  if (!preview || /^\(no matches\)/.test(preview)) return [];
  return preview
    .split("\n")
    .filter((l) => l && l !== "--" && !l.startsWith("[") && !l.startsWith("…[Filament:") && !/^\d+ paths limit reached/.test(l))
    .filter((l) => listing || /([:-])\d+\1/.exec(l)?.[1] !== "-");
}

/**
 * A read card's facts line. An image read (HarnessV3-Tools TL-D17) is the line naming the image: the card gives the
 * image's type and size as the line says them, and not that line's characters, which say nothing of it. A PDF read
 * (TL-D26) gives the pages it showed, as far as the preview proves them: the read's own note when it is there, else
 * the pages the preview holds when it is the whole result, else only where it started. A text read gives its line
 * count without the notices, then the call's facts.
 * @param {any} t
 */
export function readFacts(t) {
  const preview = String(t?.preview || "");
  const image = /^\[.*: a (\S+) image, ([^\]]+)\.\]$/.exec(preview.split("\n")[0]);
  if (image) return [`${image[1]} image, ${image[2]}`, factsOf({ ...t, chars: null })].filter(Boolean).join(" · ");
  // A coding agent's read of an image hands the picture alone, no words (HarnessV4_Tasks U9): its facts are the
  // picture's, as the loop's read says them, never "0 chars".
  const pics = Array.isArray(t?.images) ? t.images : [];
  if (pics.length && !preview.trim()) return [pics.length === 1 ? pictureFacts(pics[0]) : `${pics.length} pictures`, factsOf({ ...t, chars: null })].filter(Boolean).join(" · ");
  if (/^--- page \d+( \(no text[^)]*\))? ---$/.test(preview.split("\n")[0])) {
    const heads = [...preview.matchAll(/^--- page (\d+)/gm)].map((m) => Number(m[1]));
    const note = /\n\[Showing pages (\d+)-(\d+) of (\d+)\./.exec(preview);
    const whole = !(Number(t?.chars) > preview.length);
    const range = note
      ? `pages ${note[1]}–${note[2]} of ${note[3]}`
      : !whole
        ? `from page ${heads[0]}`
        : heads.length === 1
          ? `page ${heads[0]}`
          : `pages ${heads[0]}–${heads[heads.length - 1]}`;
    return [`PDF, ${range}`, factsOf(t)].filter(Boolean).join(" · ");
  }
  const lines = preview ? preview.split("\n").filter((l) => !l.startsWith("…[Filament:") && !/^\[Showing lines /.test(l)).length : 0;
  return [lines ? `${lines} line${lines === 1 ? "" : "s"}` : "", factsOf(t)].filter(Boolean).join(" · ");
}

/** The card kind a stub draws as (D8): the card decides — any vocabulary speaks it — with our own names as
 *  the fallback for events and logs that carry no card. Exported for the DOM-free pin. @param {any} t */
export function kindOfStub(t) {
  return t?.card?.kind || NAME_KIND[String(t?.name || "").toLowerCase()] || null;
}
/** Our own names → the card kind they draw as, for events and logs that carry no card. */
const NAME_KIND = {
  read: "read", grep: "search", glob: "list", write: "write", edit: "edit",
  bash: "shell", bash_background: "shell", bash_output: "shell", bash_kill: "shell", powershell: "shell",
  ask: "ask", plan: "todo", web_fetch: "web", web_search: "web", agent: "subagent",
  show_visual: "visual", visual_guide: "visual-guide", tasks: "tasks", lsp: "search",
};

/**
 * A plan item's status icon: done a check, pending a ring, the one in progress a spinner (the owner's of 11-10, where it
 * was an arrow) — turning while its turn runs (`live`), still once it is over or where motion is reduced.
 * @param {string} word @param {boolean} live
 */
const planIcon = (word, live) => h("span", { class: `plan-ic ${word}${word === "doing" && live ? " is-live" : ""}`, html: word === "done" ? ICONS.circleCheck : word === "doing" ? ICONS.loader : ICONS.circle });

/** A plan's items with their status icons, as a to-do card and a proposed plan's card draw them. `live`: its turn runs. @param {any[]} items @param {boolean} [live] */
function planItems(items, live = false) {
  const word = (/** @type {any} */ s) => (s === "done" || s === "completed" ? "done" : s === "doing" || s === "in_progress" ? "doing" : "pending");
  return h("div", { class: "plan-card-body" },
    ...items.map((it) => h("div", { class: `plan-item ${word(it?.status)}` },
      planIcon(word(it?.status), live),
      h("span", {}, String(it?.text ?? it?.content ?? "")))));
}

/**
 * The card title of the agent tool's stop of a sub-agent (agent_id with stop: true), as core/tool-vocab.js
 * `SUBAGENT_STOP` says it: such a call's row is a stop's, never a sub-agent's card.
 */
const SUBAGENT_STOP = "Stop sub-agent";
/** How a sub-agent's run that did not finish ended, as its card's status word. */
const SUBAGENT_ENDED = { "budget-stopped": "Budget", stopped: "Stopped", aborted: "Cut off", failed: "Failed" };
/** A sub-agent no one told the end of, as its card's soft status (HarnessV4_Tasks U1): its run was cut with it, or the
 *  session's list holds it no longer (`endFromList`). */
const SUBAGENT_UNTOLD = {
  cut: { word: "Cut off", title: "Filament stopped while this agent worked: its turn's run ended without it, and no report was recorded" },
  forgotten: { word: "End unknown", title: "This turn never heard how it ended. Filament holds this agent no longer (a session keeps its newest threads and those whose work waits for your Apply, and a task graph's other agents only while Filament runs), and no log of its own run was found to say" },
};

/**
 * Whether a call asked a saved agent by its tag (HarnessV4_Tasks E15 step 3): its run's events said the agent was
 * asked by its tag. Such a call is drawn as that agent's card; a worker the call launched is a row, named by its card.
 * @param {any} t  the call's stub
 */
export const askedCall = (t) => !!(t?.sub?.asked && t.sub.agentId);
/** Whether a call is of Filament's space tool: its loop's, or a coding agent's over Filament's MCP server. @param {any} t */
const spaceCall = (t) => /^(mcp__filament__)?space$/.test(String(t?.name || "").toLowerCase());
/**
 * Whether a call's card stands apart from the work once its turn settles: a saved agent it asked, or Filament's own
 * agent that drew or published — no picture or page is behind "Worked for…" (HarnessV4_Visuals_Plan VS-D50,
 * HarnessV4_Artifacts_Plan AFC-100: you do not go looking) —, or a routine or a watcher it proposed, whose card
 * switches it on (the owner's of 11-12: proposed right in the chat).
 * @param {any} t  the call's stub
 */
export const apartCall = (t) => {
  if (askedCall(t)) return true;
  if (spaceCall(t) && proposedOf(t)) return true;
  if (!t?.sub?.agentId) return false;
  const id = String(t.sub.agentId);
  const exchange = Number(t.sub.exchange) || 0;
  return !!chipActions.drewOf?.(id, exchange)?.drew.length || !!chipActions.madeOf?.(id, exchange)?.length;
};

/**
 * A sub-agent's card (the `agent` tool, or another vocabulary's Task): the task in a few words, while it runs the
 * call it is making now, once over its tool uses, tokens and time; opened, the prompt it was given, its own calls as
 * rows (grouped like a round's), and its report. `t.sub` is what the run's `subagent-*` events said (alignEvents);
 * an archived call without them shows its task alone. A background launch's call returns at once while the
 * sub-agent works on, so the card runs as long as the sub-agent does — and where its turn stopped hearing of it (it
 * paused, or ended first), its end is the session's list's (`endFromList`, HarnessV4_Tasks U1); one Filament holds no
 * longer takes its end from its own run's log (`gone`), and says so where that is gone too; one whose launching
 * call was cut with its run was cut with it. "Open conversation" opens its whole conversation in the viewer, while
 * Filament holds one. A saved agent the main agent asked is drawn as that agent's card instead (agent-card.js).
 * @param {any} t @param {any} base @param {{ onPrompt?: (t: any) => void, runId?: string, round?: number | null, turnAt?: TurnAt | null, moveRun?: string | null, drawn?: DrawnRows | null }} o
 */
function subagentRow(t, base, o) {
  const told = t.sub || null;
  const end = subagentEnd(t);
  const s = end ? { ...told, ...end } : told;
  const unsaid = s?.state === "stopped" ? SUBAGENT_UNTOLD[s.status === "forgotten" && t.state === "cut" ? "cut" : s.status] || null : null;
  // Its own run's log could not be read (not: is gone): the card says why it knows no more.
  const untold = unsaid === SUBAGENT_UNTOLD.forgotten && s.unread ? { word: unsaid.word, title: `${unsaid.title}: reading it failed (${s.unread})` } : unsaid;
  const running = !end && (t.state === "running" || s?.state === "running");
  // The card that stands for this call (`rememberedStub`'s): drawn into, where there is one.
  const stands = o.drawn?.get(`call:${t.id}`)?.row || null;
  // A saved agent the main agent asked by its tag (HarnessV4_Tasks E15 step 3): its card, in this row's place — the one
  // that stands, painted from what its call says now, as it paints its own parts.
  if (askedCall(t)) {
    /** @type {Parameters<typeof askedCardRow>[1]} */
    const io = { running, listed: !!end && !end.gone, follow: (row, onChange, gone) => followStore(row, onChange, gone), opened: { get: () => openState.get(t.id) === true, set: (open) => openState.set(t.id, open) } };
    return (stands && askedCardAgain(stands, s, io)) || askedCardRow(s, io);
  }
  const calls = s ? s.order.map((/** @type {string} */ id) => s.tools.get(id)).filter(Boolean) : [];
  // Its calls an ended turn's read left apart (labels.js `fillCalls`): counted as its run counted them, read as it opens.
  const apart = s?.apart && !s.apart.filled ? s.apart : null;
  const count = apart ? Number(apart.calls) || 0 : calls.length;
  const task = line(t.card?.subject ?? s?.description ?? argsOf(t).brief ?? "");
  const now = running ? [...calls].reverse().find((c) => c.state === "running") : null;
  const uses = count ? `${count} tool use${count === 1 ? "" : "s"}` : "";
  // Its own plan (a coding agent's sub-agent, HarnessV3-ACP AC3-4): how far it is while it runs, the list opened.
  const plan = Array.isArray(s?.plan) ? s.plan : [];
  const steps = plan.length ? `${plan.filter((/** @type {any} */ p) => p?.status === "done").length} of ${plan.length} done` : "";
  const ms = s?.ms ?? t.ms;
  // The call it makes now, named once it has run a moment (labels.js CALL_NAMED_AFTER_MS): till then the line keeps its
  // count, so a quick call never swaps its words in and out.
  const namedIn = now && !s?.asking ? callNamedIn(now) : 0;
  /** Its line while it runs, the call named or not. @param {boolean} named */
  const runningWords = (named) =>
    [s?.asking ? (s.asking.to === "lead" ? (s.asking.plan ? "Sent its lead its plan" : "Asks its lead") : "Asks you") : now && named ? line(`${now.card?.title || now.name} ${now.card?.subject ?? ""}`) : uses || "Starting", steps, s?.background ? "in the background" : ""].filter(Boolean).join(" · ");
  const secondary = running
    ? runningWords(!namedIn)
    : [uses, s?.tokens ? `${fmt.n(s.tokens)} tokens` : "", ms != null && ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : ""].filter(Boolean).join(" · ");
  const ended = s && s.state === "failed" ? SUBAGENT_ENDED[s.status] || "Failed" : null;
  const section = (/** @type {string} */ label, /** @type {any} */ content) => [h("div", { class: "sub-label" }, label), content];
  // The report is the sub-agent's reply, written in markdown: it reads as one. The prompt stays verbatim.
  const reportEl = (/** @type {string} */ text) => { const el = h("div", { class: "sub-prompt sub-report a-md" }); setHtml(el, mdChat(text, null).out); return el; };
  // Filament's sub-agent is named by its card, in the row's kind; a coding agent's own helper has none, and keeps the
  // kind its agent gives it (Cursor's "explore").
  const meta = s ? [s.card ? "" : s.agent, s.model, handedWords(s.handed), s.followUp ? "follow-up" : "", s.background ? "background" : "", s.rounds ? `${s.rounds} round${s.rounds === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") : "";
  // What the main agent attached to its message (`attach`), each by name in its tooltip.
  const attachedSaid = attachedWords(s?.attached);
  const attachedEl = attachedSaid ? h("span", { class: "sub-attached", title: attachedNames(s?.attached) }, `${meta ? " · " : ""}${attachedSaid}`) : null;
  // Filament's own agent opens the conversation Filament holds; a coding agent's own has none there, and opens its
  // thread as this turn's run tells it (HarnessV4_Tasks E15 step 5, AG-153).
  const ownOf = s && !s.agentId && o.runId ? guestId(o.runId, String(t.id)) : null;
  const openIt = !chipActions.openSubagent ? null : s?.agentId && !s.gone ? String(s.agentId) : ownOf;
  // Its calls' rows are kept rows of their own (`DrawnRows`), placed in the list that stands once the card is drawn: a
  // drawing's own list would take them off the page, and a card drawn again moved every one into the new one (the
  // performance Hunter's find of 10-25). Built only while the card stands open (`placeCalls`).
  const list = count ? h("div", { class: "tool-children", "data-key": "calls", "data-placed": "" }) : null;
  const body = h("div", { class: "sub-card" },
    meta || attachedEl || openIt
      ? h("div", { class: "sub-meta" },
          meta,
          attachedEl,
          openIt ? h("button", { class: "subagent-open", type: "button", title: ownOf ? "Its thread in the Agents tab: what it was told, its calls and its words" : "Its whole conversation: the prompt, every round and its report", onclick: opensConversation(openIt) }, "Open conversation") : null)
      : null,
    ...(s?.prompt ? section("Prompt", h("div", { class: "sub-prompt" }, s.prompt)) : task ? section("Task", h("div", { class: "sub-prompt" }, task)) : []),
    ...(plan.length ? section(`Plan · ${steps}`, planItems(plan)) : []),
    // Its commands go to the background through its own run (HarnessV4_Four_Plan FO-D20), once that run is named.
    ...(list ? section("Tool calls", list) : []),
    // Its lead answered a call it asked you about (HarnessV3-TaskGraph-v2 TG2-D41), its question (TG2-D49) or its plan
    // (TG2-D50): each answer, in the lead's words.
    ...(s?.answers?.length ? section("Its lead answered", h("div", { class: "sub-prompt sub-answers" }, ...s.answers.map((/** @type {{ allowed?: boolean, question?: boolean, plan?: boolean, words: string }} */ a) => h("div", { class: "sub-answer" }, a.plan ? `To its plan: ${a.words}` : a.question ? `To its question: ${a.words}` : a.allowed ? "Yes to its call" : /^no\b/i.test(a.words) ? a.words : `No: ${a.words}`)))) : []),
    ...(s?.report ? section("Report", reportEl(s.report)) : []),
    ...(s?.error ? [failureCard(h, failureWords({ error: s.error, failure: s.failure }), { inset: true })] : []));
  const row = toolRow({
    ...base,
    running,
    icon: ICONS.bot,
    kind: s?.card?.name || "Agent",
    primary: task ? [task] : [],
    secondary,
    // A stopped sub-agent reads a soft Stopped, like the command a stop cut — never a red word beside the parent's.
    status: ended ? { word: ended, title: s?.error || `the agent ended ${s?.status}` } : s?.state === "stopped" ? { ...(untold || { word: "Stopped", title: "stopped — what it finished is its report" }), soft: true } : base.status,
    body,
    // Opened or folded as the person left it (`openStub`), from the first: it is drawn into the card that stands before
    // that is said again, and a card drawn closed into an open one folded it for a moment.
    open: openState.get(t.id) === true,
  });
  // A call not named yet: its line marks the call it waits for, and names it when the wait is out.
  const naming = running && now && namedIn ? { id: String(now.id), words: runningWords(true), ms: namedIn } : null;
  if (naming) row.querySelector(".tool-secondary")?.setAttribute("data-call", naming.id);
  /** The card on the page, its calls placed. @param {HTMLElement} card */
  const placed = (card) => {
    if (list) placeCalls(card, standing(list), s, { ...o, moveRun: s.run ? String(s.run) : null }, apart && o.runId ? { sub: told, runId: o.runId } : null);
    if (naming) nameWhenLong(card, naming);
    return card;
  };
  // What Filament's own agent drew (HarnessV4_Visuals_Plan VS-D50) and published (HarnessV4_Artifacts_Plan AFC-100): a
  // line each under its row, folded or not, each picture opened under it, each artifact in its own tab; the lines
  // follow the page's list, where the drawing is said before the turn hears of anything. Made once with the card: its
  // row is drawn into the one that stands, and the lines and the pictures opened under it stay as they are.
  if (!s?.agentId) return placed(stands && stands !== row ? morph(stands, row) : row);
  const agent = `${s.agentId}:${Number(s.exchange) || 0}`;
  if (stands?.classList.contains("sub-drew") && stands.getAttribute("data-agent") === agent) {
    morph(stands.children[0], row);
    return placed(stands);
  }
  const drew = drewPart(String(s.agentId), Number(s.exchange) || 0);
  const made = madePart(String(s.agentId), Number(s.exchange) || 0);
  const paint = paintsBoth(drew, made);
  paint();
  followStore(drew.line, paint);
  return placed(h("div", { class: "sub-drew", "data-agent": agent, "data-self": "" }, row, drew.line, drew.box, made.line));
}

/**
 * What a sub-agent's card keeps after its drawing — the press that opens its conversation, the paint its lines follow —
 * made here, holding what it names alone: one made in `subagentRow` held that drawing's whole scope, and through its
 * list of calls the card it drew to patch the one on the page — prompt, report and all — so every card kept a dead twin
 * of itself for as long as it stood (the lab's of 11-17: 19,370 of a hidden window's 19,604 nodes let go of).
 * @param {string} id
 */
const opensConversation = (id) => (/** @type {Event} */ e) => {
  e.stopPropagation();
  chipActions.openSubagent?.(id);
};
/** A call's prompt shown, holding the call alone: one made in `stubOf` held its drawing's scope (layout.js
 *  `pressesPrompt`). @param {(t: any) => void} show @param {any} t */
const showsPrompt = (show, t) => () => show(t);
/** A group's toggle, kept as its open state by its own key: made here, as the press above, so it holds the key alone —
 *  one made in `roundRows` held the box its drawing made and dropped. @param {string} key */
const keepsOpen = (key) => (/** @type {Event} */ e) => openState.set(key, /** @type {HTMLDetailsElement} */ (e.currentTarget).open);
/** @param {{ paint: () => void }} drew @param {{ paint: () => void }} made */
const paintsBoth = (drew, made) => () => {
  drew.paint();
  made.paint();
};

/**
 * A sub-agent card's calls, by its fold on the page: what its rows are drawn from as its newest drawing had it, and the
 * list on the page they go in. A card builds its rows only while it stands open, and lets them go as it closes
 * (`placeCalls`): a long turn's cards drew every call of every sub-agent into cards nobody opened — 25,649 of a 22-hour
 * turn's 26,627 rows, in the lab, kept with every drawing of them (the owner's of 11-17). Held by the fold, never by a
 * handler made beside it: the fold's toggle reads it (`callsToggled`). `found`: the words Find built a closed card's
 * rows for (`revealCalls`), which keep them through the card's drawings until Find lets them go (`foldCalls`). `need`:
 * the alignment's own sub, where an ended turn's read left its calls apart, and the run they are read from (`readApart`).
 * @typedef {{ s: any, o: any, box: HTMLElement, found?: string, need?: { sub: any, runId: string } | null }} CardCalls
 * @type {WeakMap<Element, CardCalls>}
 */
const callsOf = new WeakMap();

/** The fold of a sub-agent's card: its row, or the row over the lines of what it drew. @param {Element} card */
const foldOf = (card) => /** @type {HTMLDetailsElement} */ (card.classList.contains("sub-drew") ? card.children[0] : card);

/**
 * A sub-agent card's call rows placed in its list on the page while the card stands open, or while Find holds them in a
 * closed one, else let go (`callsOf`).
 * @param {HTMLElement} card @param {HTMLElement} box @param {any} s @param {any} o @param {CardCalls["need"]} [need]
 */
function placeCalls(card, box, s, o, need = null) {
  const fold = foldOf(card);
  const was = callsOf.get(fold);
  /** @type {CardCalls} */
  const c = { s, o, box, found: was?.box === box ? was.found : undefined, need };
  callsOf.set(fold, c);
  if (fold.open || c.found) buildCalls(c);
  else letGoCalls(c);
}
/** @param {CardCalls} c */
const buildCalls = (c) => {
  const apart = c.need?.sub.apart;
  if (apart && !apart.filled) return readApart(c, apart);
  placeChildren(c.box, roundRows({ order: c.s.order, tools: c.s.tools, plan: null }, c.o));
};
/**
 * A card whose calls an ended turn's read left apart, opened or found: its calls read once from its run — the read on
 * its way shared by every drawing of the card — and filled into its sub (labels.js `fillCalls`), its rows drawn on the
 * newest drawing's list where the card stands open still or Find holds it. A moment's words meanwhile; a read that
 * fails says so, and the card's next opening reads again.
 * @param {CardCalls} c @param {any} apart  the sub's shared `apart`
 */
function readApart(c, apart) {
  const need = /** @type {{ sub: any, runId: string }} */ (c.need);
  const fold = /** @type {HTMLDetailsElement | null} */ (c.box.closest("details"));
  apart.read ||= Promise.resolve()
    .then(() => (chipActions.readCalls ? chipActions.readCalls(need.runId, { round: apart.round, parent: apart.parent }) : Promise.reject(new Error("no reader"))))
    .then(
      (events) => void fillCalls(need.sub, events),
      (e) => {
        apart.read = null;
        throw e;
      },
    );
  placeChildren(c.box, [h("div", { class: "tool-reading muted" }, "Reading its calls…")]);
  /** The card's newest drawing's calls, where it stands still. */
  const standingNow = () => {
    const now = fold ? callsOf.get(fold) : undefined;
    return now && now.box.isConnected ? now : null;
  };
  apart.read.then(
    () => {
      const now = standingNow();
      if (!now || !fold || !(fold.open || now.found)) return;
      buildCalls(now);
      if (fold.open) for (const p of Array.from(now.box.querySelectorAll("pre.term-out[data-end]"))) outputToEnd(/** @type {HTMLElement} */ (p));
    },
    () => {
      const now = standingNow();
      if (!now || !fold) return;
      // Filled meanwhile by Find's read of every card's (timeline.js `fillApart`): its rows, not the failure.
      if (apart.filled) {
        if (fold.open || now.found) buildCalls(now);
      } else if (fold.open) placeChildren(now.box, [h("div", { class: "tool-reading muted" }, "Its calls could not be read — close it and open it again to try again")]);
    },
  );
}
/**
 * Closed cards' rows taken off them, and out of the rows their turns keep (`DrawnRows`: theirs, their groups' and those
 * of the sub-agents' cards among them), so nothing holds them: one pass over each turn's kept rows, however many cards.
 * @param {CardCalls[]} cs
 */
function letGoAll(cs) {
  const full = cs.filter((c) => c.box.firstChild);
  /** @type {Map<Map<string, any>, Set<Node>>} */
  const byDrawn = new Map();
  for (const c of full) {
    const drawn = c.o.drawn;
    if (!drawn) continue;
    if (!byDrawn.has(drawn)) byDrawn.set(drawn, new Set());
    byDrawn.get(drawn)?.add(c.box);
  }
  for (const [drawn, boxes] of byDrawn)
    for (const [key, kept] of drawn)
      for (let n = kept.row?.parentNode; n; n = n.parentNode)
        if (boxes.has(n)) {
          drawn.delete(key);
          break;
        }
  for (const c of full) c.box.replaceChildren();
}
/** @param {CardCalls} c */
const letGoCalls = (c) => letGoAll([c]);
/**
 * A sub-agent's card opened or closed, by a press or not (Find opens the one its match is in): its calls' rows built
 * where they are not, their outputs at their end; closed, let go, unless Find holds them.
 * @param {HTMLDetailsElement} fold
 */
function callsToggled(fold) {
  const c = callsOf.get(fold);
  if (!c) return;
  if (!fold.open) return void (c.found || letGoCalls(c));
  if (!c.box.firstChild) buildCalls(c);
  for (const p of Array.from(c.box.querySelectorAll("pre.term-out[data-end]"))) outputToEnd(/** @type {HTMLElement} */ (p));
}

/** The lists of the sub-agents' cards under `root`, each with what its card's calls are drawn from. @param {Element | null} root */
function cardCalls(root) {
  /** @type {[HTMLDetailsElement, CardCalls][]} */
  const out = [];
  for (const box of Array.from(root?.querySelectorAll?.('.tool-children[data-key="calls"]') || [])) {
    const fold = /** @type {HTMLDetailsElement | null} */ (box.closest("details"));
    const c = fold ? callsOf.get(fold) : undefined;
    if (fold && c?.box === box) out.push([fold, c]);
  }
  return out;
}
/**
 * A call's own fields its row never draws as the record holds them: its ids, its clock and its sizes (drawn as "9.9k
 * chars", "1.2s"), its pictures (drawn as pictures and their type, named by their content) and the marks it is drawn
 * by. Find's words of three letters met them in nearly every call — `too` in each id, a picture's name in hex —, as
 * `one` met the state `done`, which no row says, and every closed card built its rows for them (the review of 11-19).
 */
const UNDRAWN = new Set(["id", "requestId", "at", "ms", "chars", "ok", "movable", "notRun", "movedBy", "images"]);
/**
 * Whether any words in a call's record (`depth` 0) hold `needle` (lower case): its strings as they are — a path's
 * backslashes, a quote, a line break —, never their JSON, which wrote each of those otherwise; not its fields no row
 * draws (`UNDRAWN`). A sub-agent's own calls are asked by `callsHold`. @param {any} v @param {string} needle
 * @param {number} [depth] @returns {boolean}
 */
function wordsHold(v, needle, depth = 0) {
  if (typeof v === "string") return v.toLowerCase().includes(needle);
  if (typeof v === "number") return String(v).includes(needle);
  if (!v || typeof v !== "object" || depth > 8) return false;
  if (v instanceof Map) {
    for (const x of v.values()) if (wordsHold(x, needle, depth + 1)) return true;
    return false;
  }
  for (const k of Object.keys(v)) {
    if (k === "sub" || (depth === 0 && (UNDRAWN.has(k) || (k === "state" && v[k] === "done")))) continue;
    if (wordsHold(v[k], needle, depth + 1)) return true;
  }
  return false;
}
/** Whether a sub-agent's calls' records hold `needle` (lower case), its own sub-agents' too. @param {any} s @param {string} needle @returns {boolean} */
function callsHold(s, needle) {
  return s.order.some((/** @type {string} */ id) => {
    const t = s.tools.get(id);
    return !!t && (wordsHold(t, needle) || (!!t.sub?.tools && callsHold(t.sub, needle)));
  });
}
/** The fewest characters Find's words have before closed cards build their rows for it: two built nearly every card. */
export const REVEAL_FROM = 3;
/**
 * Find covers what is drawn: each closed sub-agent card under `root` whose calls' records hold `needle` (lower case)
 * builds its rows, closed still — Find opens the one its match is in — and keeps them for it; one Find built rows for
 * that the words no longer match lets them go. Words shorter than `REVEAL_FROM` build none. → how many cards built them.
 * @param {Element | null} root @param {string} needle
 */
export function revealCalls(root, needle) {
  let built = 0;
  /** @type {CardCalls[]} */
  const left = [];
  for (const [fold, c] of cardCalls(root)) {
    if (fold.open) continue;
    if (needle.length < REVEAL_FROM || !callsHold(c.s, needle)) {
      if (c.found) left.push(c);
      c.found = undefined;
      continue;
    }
    c.found = needle;
    // Built for earlier words: its own cards are among those found here.
    if (c.box.firstChild) continue;
    buildCalls(c);
    built += 1 + revealCalls(c.box, needle);
  }
  letGoAll(left);
  return built;
}
/** Find closed: the cards it built rows for that stand closed let them go (`revealCalls`). @param {Element | null} root */
export function foldCalls(root) {
  /** @type {CardCalls[]} */
  const shut = [];
  for (const [fold, c] of cardCalls(root)) {
    c.found = undefined;
    if (!fold.open) shut.push(c);
  }
  letGoAll(shut);
}

/**
 * A sub-agent's running call named on its card's line once it has run a while, though no event of its own comes to
 * draw the card again — where the line on the page still waits for that call: a card drawn since, for its next call or
 * its end, says what it says then. @param {Element} card @param {{ id: string, words: string, ms: number }} w
 */
function nameWhenLong(card, w) {
  globalThis.setTimeout?.(() => {
    const el = Array.from(card.querySelectorAll(".tool-secondary[data-call]")).find((x) => x.getAttribute("data-call") === w.id);
    if (!el) return;
    el.removeAttribute("data-call");
    el.textContent = w.words;
  }, w.ms);
}

/**
 * A command's output, scrolled to its end once it is in the page: the newest lines are where a running command is,
 * and where a finished one says how it ended. `result`: the call's result, not its live output (`previewParts`).
 * @param {string} cls @param {string} text @param {boolean} [result]
 */
function termOut(cls, text, result = false) {
  // `data-end`: the timeline puts it at its end as it places the cards, in the frame it is drawn (`keepOutputs`).
  const el = h("pre", { class: cls, "data-end": "", ...(result ? { "data-result": "" } : {}) }, text);
  // Held weakly till the frame (lib/weak-frame.js): a callback over each output drawn kept every drawing a window made
  // while it got no frames (the owner's of 11-17).
  nextFrame(el, outputToEnd);
  return el;
}

/**
 * The nearest row closed around an element, or null where every row around it stands open: what a closed row holds is
 * not laid out, and each read of its size laid that row out on its own. @param {Element} el
 */
export function shutRowOf(el) {
  let row = el.closest("details");
  while (row && /** @type {HTMLDetailsElement} */ (row).open) row = /** @type {any} */ (row.parentNode)?.closest?.("details") ?? null;
  return /** @type {HTMLDetailsElement | null} */ (row);
}

/**
 * A command's output not yet at its end (`data-end`) put there: now, where it can be seen, else as the row closed
 * around it opens. @param {HTMLElement} el
 */
export function outputToEnd(el) {
  if (!el.hasAttribute("data-end")) return;
  el.removeAttribute("data-end");
  atEnd(el);
}
/**
 * The outputs each closed row puts at their end as it opens, held weakly: the row hears its opening once, however many
 * drawings of its outputs came while it was closed — a listener for each held every drawing of a running command's
 * output (the review of 11-17: 253,131 listeners where a clean drawing has 148,277).
 * @type {WeakMap<Element, Set<WeakRef<HTMLElement>>>}
 */
const endsOnOpen = new WeakMap();
/** @param {HTMLElement} el */
const atEnd = (el) => {
  const shut = shutRowOf(el);
  if (!shut) return void (el.scrollTop = el.scrollHeight);
  const waiting = endsOnOpen.get(shut);
  if (waiting) {
    for (const r of waiting) if (!r.deref()?.isConnected) waiting.delete(r);
    waiting.add(new WeakRef(el));
    return;
  }
  endsOnOpen.set(shut, new Set([new WeakRef(el)]));
  shut.addEventListener("toggle", openedToEnd);
};
/** A closed row opened: its outputs still drawn go to their end, or wait for a row still closed around them. @param {Event} e */
function openedToEnd(e) {
  const row = /** @type {HTMLDetailsElement} */ (e.currentTarget);
  if (!row.open) return;
  const waiting = endsOnOpen.get(row);
  endsOnOpen.delete(row);
  row.removeEventListener("toggle", openedToEnd);
  for (const r of waiting || []) {
    const el = r.deref();
    if (el?.isConnected) atEnd(el);
  }
}

/** The change each edit card's diff shows, by the part that holds it (`stubOf`'s edit rows). @type {WeakMap<Element, string>} */
const diffShown = new WeakMap();

/**
 * An edit card's read of its change and its counts, made apart from the drawing: the closures one call makes share its
 * scope, and this one waits — its fold closed, its card far below the screen — so made in `stubOf` it held that
 * drawing, and the card it built to draw into the one that stands (Fable 5.2's review of 11-17). It finds its parts in
 * the row it is given; the parts a read lands in are the ones that stand for them (`standing`).
 * @param {string | null} runId @param {string} target @param {number | null} round @param {any} call
 */
const readsChange = (runId, target, round, call) => (/** @type {Element} */ row) => {
  const counts = row.querySelector(".edit-counts");
  const slot = row.querySelector(".inline-diff-slot");
  if (!counts || !slot) return;
  const change = JSON.stringify([runId, target, round, call]);
  inlineEditDiff(runId, target, {
    round,
    call,
    onCounts: (plus, minus) => morphChildren(standing(counts), [" ", plus ? h("span", { class: "diff-add" }, `+${fmt.n(plus)}`) : null, minus ? h("span", { class: "diff-del" }, `−${fmt.n(minus)}`) : null]),
  }).then((el) => {
    const at = standing(slot);
    if (!el || !at.isConnected || diffShown.get(at) === change) return;
    at.replaceChildren(el);
    diffShown.set(at, change);
  });
};

/**
 * The Background button on a running command's card (HarnessV4_Four_Plan E21): pressed, the command goes on as a
 * background shell and the agent has its answer; the card ends as that answer lands. A press that cannot move it says
 * why in a toast (`chipActions.toBackground`), and the button is pressable again. Sent, it says so on every drawing of
 * its row until the card ends (`sending`): the row is drawn again at each line of the command's output.
 * @param {string} runId @param {string} callId
 */
function backgroundButton(runId, callId) {
  const key = `${runId}\n${callId}`;
  const busy = sending.has(key);
  return h("button", {
    class: "tool-bg", type: "button",
    title: "Send it to the background: it keeps running, the agent has its answer now and goes on, and it is told when the command ends",
    ...(busy ? { disabled: "" } : {}),
    onclick: (/** @type {Event} */ e) => {
      // On the folded row: the press moves the command and never opens its card.
      e.preventDefault();
      e.stopPropagation();
      const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
      sending.add(key);
      btn.disabled = true;
      btn.textContent = "Sending…";
      void chipActions.toBackground?.(runId, callId).then((why) => {
        if (!why) return;
        sending.delete(key);
        btn.disabled = false;
        btn.textContent = "Run in background";
      });
    },
  }, busy ? "Sending…" : "Run in background");
}
/** The commands sent to the background whose card has not ended, by run and call (`backgroundButton`). @type {Set<string>} */
const sending = new Set();

/**
 * How long a running command runs before its folded row offers Run in background (the Designer's of 10-28, on the
 * owner's "when you run a command it's card shows up as opened. not needed"): a quick command's row never shows it, so
 * no link flashes on every `ls` where a press meant to open the row lands.
 */
export const OFFER_AFTER_MS = 5000;
/** How long a call has run, by its start's clock; 0 where its start is not known. @param {any} t */
const ranFor = (t) => (Number(t.at) > 0 ? Math.max(0, Date.now() - Number(t.at)) : 0);
/** A command the shell ran in the foreground: not one of the background shell's own calls. @param {any} t */
const foreground = (t) => kindOfStub(t) === "shell" && !/^bash_(background|output|kill)$/.test(String(t.name || "").toLowerCase());
/**
 * A finished command whose card the person opened, while its turn runs: it stays open where it stands, out of any
 * group, so its result lands in the box they were reading and nothing below it moves. It folds with the rest of the
 * work when the turn settles. The page opens no command's card by itself. @param {any} t @param {boolean} live
 */
export const heldOpen = (t, live) => live && (t.state === "done" || t.state === "failed") && foreground(t) && openState.get(t.id) === true;
/**
 * A running command's Run in background shows once it has run OFFER_AFTER_MS — unless it ended first — though no event
 * of its own comes to draw it again then. @param {HTMLElement} btn @param {any} t
 */
function offerWhenLong(btn, t) {
  const wait = OFFER_AFTER_MS - ranFor(t);
  if (wait <= 0) return btn;
  btn.classList.add("hidden");
  const w = typeof window !== "undefined" ? window : null;
  w?.setTimeout?.(() => {
    if (t.state === "running") btn.classList.remove("hidden");
  }, wait);
  return btn;
}
/** A running command's seconds, from the first: "· 3s", "· 1m 5s". @param {number} ms */
const runningFor = (ms) => {
  const s = Math.floor(ms / 1000);
  return s < 1 ? "" : `· ${s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}`;
};

/**
 * One stub. The row is chosen by the card's KIND (D8) — any vocabulary speaks it — with our own names as the
 * fallback for events older than the card. @param {any} t
 * @param {{ onPrompt?: (t: any) => void, runId?: string, round?: number | null, turnAt?: TurnAt | null, moveRun?: string | null, drawn?: DrawnRows | null, live?: boolean }} [o]
 */
function stubOf(t, o = {}) {
  const name = String(t.name || "").toLowerCase();
  const a = argsOf(t);
  // D8: a server-attached card names the target in the call's own words — the path, the command, the pattern —
  // whatever vocabulary spoke it. The renderer never guesses by name.
  const subj = t.card?.subject != null ? String(t.card.subject) : null;
  const k = kindOfStub(t);
  const running = t.state === "running";
  const facts = factsOf(t);
  const prompt = t.requestId && o.onPrompt ? showsPrompt(o.onPrompt, t) : undefined;
  const tone = name.startsWith("filament_memory") ? "memory" : name === "agent" || name === "task" || t.sub ? "agent" : familyOf(t) || "other";
  const base = { running, status: statusOf(t) || undefined, prompt, source: t.source || undefined, tone };

  const bare = name.replace(/^mcp__filament__/, "");
  if (bare.startsWith("filament_memory")) {
    // Memory's reads recall (a search, the sessions, a load, a grep); the rest write. Opened, what it was given and
    // what it returned.
    // One that failed or never ran — memory's tools off in the chat, say — is named by what it asked, never by what it
    // would have done: its status says how it ended (the owner's drive of 10-29).
    const pair = /_(search|sessions|load|grep)$/.test(bare) ? ["Recalling", "Recalled", "Recall"] : ["Remembering", "Remembered", "Remember"];
    // What it looks for or keeps — its query, its words, the chat it loads, the memory it acts on — whole where its card
    // kept them (a coding agent's call too, whose args are its card's line), else from its input; and the rest of it.
    const c = t.card || {};
    const key = ["query", "text", "session", "id"].find((k) => a[k] != null && String(a[k]).trim());
    const asked = c.whole != null ? String(c.whole) : key ? String(a[key]) : "";
    const given = c.given != null ? String(c.given) : c.whole != null ? "" : givenWords(a, key);
    const ask = { asked, given };
    return toolRow({
      ...base, icon: ICONS.sparkles,
      kind: running ? pair[0] : base.status ? pair[2] : pair[1],
      primary: [line(asked || bare)], secondary: facts,
      body: t.preview || given || (asked.trim() && line(asked) !== asked.trim()) ? memoryBody(t, ask) : undefined,
    });
  }
  if (k === "read") {
    // A read of an image shows the picture the model got, open, in place of its one line of words (HarnessV4_Tasks U9).
    const shots = picturesPart(t, pictureAltOf(t), o.turnAt?.there);
    return toolRow({
      ...base, icon: ICONS.search, kind: t.card?.title || (running ? "Reading" : "Read"),
      primary: [fileChip(subj ?? a.path ?? "", o.turnAt?.there)],
      secondary: readFacts(t),
      body: shots ? h("div", { class: "term-card picture-card" }, shots) : t.preview ? previewBody(t) : undefined,
      open: pictured(t),
    });
  }
  if (k === "search" || k === "list") {
    const listing = t.card ? k === "list" : name === "glob";
    const pattern = line(subj ?? a.pattern ?? "");
    const hits = searchHits(t.preview, listing);
    return toolRow({
      ...base, icon: ICONS.search,
      kind: t.card?.title || (running ? (listing ? "Listing" : "Searching") : (listing ? "Listed" : "Searched")),
      primary: pattern ? [`${listing ? "List" : "Find"} ${pattern}`] : [],
      secondary: [a.path || a.dir ? line(a.path || a.dir) : "", hits.length ? `${hits.length} hit${hits.length === 1 ? "" : "s"}` : "", facts].filter(Boolean).join(" · "),
      body: hits.length ? previewBody(t) : undefined,
    });
  }
  if (k === "write" || k === "edit") {
    // §5.4: the finished call carries its file's inline diff (B2), fetched once from the run's changes and
    // rendered by the rich renderer — where they hold nothing of the file (outside every git place, or a turn with no
    // run), the call's own change (HarnessV4_Four_Plan E22): a call that ran alone, so a change never made never
    // looks made (FO-D8). While running the row stays closed and light.
    /** @type {any} */
    let body;
    // The edit chip: pencil, Edited, the file, and the change as +green/−red — in LINES, from the round's
    // working-tree snapshot, the same numbers as the turn's files card (they were estimated tokens, and never filled).
    // The counts and the diff are read after the card is drawn: each lands in the part that stands for its own
    // (`standing`), which a drawing of the card again leaves as it is (`data-placed`).
    const counts = h("span", { class: "edit-counts", "data-placed": "", title: "lines added and removed: from the round's working-tree snapshot, else from the call itself" });
    /** @type {((row: Element) => void) | null} */
    let read = null;
    let known = false;
    // One on another machine (`there`) changed that machine's file: nothing of this one's record is asked for it.
    const there = o.turnAt?.there || null;
    const call = !there && t.state === "done" && o.turnAt && t.id != null && !t.idless ? { chain: o.turnAt.chain, n: o.turnAt.n, ...(o.turnAt.agent ? { agent: o.turnAt.agent } : {}), id: String(t.id) } : null;
    // A call that failed or never ran changed nothing: its card opens on its own words, why (FOC-16).
    if (!running && t.state !== "done" && t.preview) body = previewBody(t);
    else if (!running && there && (subj ?? a.path)) body = h("p", { class: "pane-note" }, `The change is in the file on ${there.name}: its chat there shows it.`);
    else if (!running && (o.runId || call) && (subj ?? a.path)) {
      const runId = o.runId ? String(o.runId) : null;
      const target = String(subj ?? a.path);
      const round = Number.isInteger(t.round) ? t.round : o.round ?? null;
      body = h("div", { class: "inline-diff-slot", "data-path": target, "data-placed": "" });
      // The change it shows: a card drawn again reads it again, and the diff that stands is left as it is — where the
      // reader scrolled it, what they selected in it.
      read = readsChange(runId, target, round, call);
      known = changeKnown(runId, target, round, call);
    }
    // The errors the language server found in the file as the call left it (the owner's LSP of 11-04): counted on its
    // row, listed over its change.
    const errs = !running && Number(t.lsp?.errors) > 0 ? t.lsp : null;
    const errsFact = errs ? h("span", { class: "edit-errors", title: "errors the language server found in the file as this call left it" }, `${fmt.n(errs.errors)} error${errs.errors === 1 ? "" : "s"}`) : null;
    if (errs) body = h("div", { class: "edit-card" }, lspErrors(errs), body);
    const row = toolRow({
      ...base, icon: ICONS.pencil,
      kind: t.card?.title || (running ? (k === "write" ? "Writing" : "Editing") : (k === "write" ? "Wrote" : "Edited")),
      primary: [fileChip(subj ?? a.path ?? "", there), counts], secondary: errsFact ? [errsFact, facts ? ` · ${facts}` : null] : facts,
      body,
    });
    // A change read already draws at once; else the card reads once it is shown (V4-D304): a closed fold's wait.
    if (read && known) read(row);
    else if (read) readWhenShown(row, read);
    return row;
  }
  if (k === "shell") {
    if (name === "bash_background" || name === "bash_output" || name === "bash_kill") {
      // The background shell family: the id is the subject, the preview is the early/new output the model got.
      const command = line(subj ?? a.command);
      const id = String(a.id || "");
      const body = t.preview ? h("div", { class: "term-card" }, h("pre", { class: `term-out${t.state === "failed" ? " fail" : ""}`, "data-result": "" }, t.preview)) : null;
      const kind = t.card?.title || (name === "bash_background" ? (running ? "Starting" : "Started") : name === "bash_output" ? (running ? "Reading" : "Read") : running ? "Stopping" : "Stopped");
      return toolRow({ ...base, icon: ICONS.terminal, kind, primary: [], secondary: [command || `bg ${id}`, facts].filter(Boolean).join(" · "), body });
    }
    const command = line(subj ?? a.command);
    const code = t.exitCode != null ? `exit ${t.exitCode}` : "";
    // The row reads the command without its shell (the card's subject); opened, the card shows the line the call ran.
    const ran = typeof a.command === "string" && a.command.trim() ? a.command : command;
    // A command the developer may send to the background while it runs (HarnessV4_Four_Plan E21): through the run
    // that runs it — a helper's own (FO-D20), else the turn's.
    const moveRun = o.moveRun !== undefined ? o.moveRun : o.runId || null;
    const movable = running && !!t.movable && !!moveRun && !!chipActions.toBackground;
    // Its card ended: a press that sent it says so no more.
    if (!running && moveRun) sending.delete(`${moveRun}\n${t.id}`);
    // A card the person opened as it ran keeps its box's height at its end: the result lands where the live output stood.
    const held = heldOpen(t, !!o.live);
    const body = h("div", { class: "term-card" },
      h("pre", { class: "term-cmd" }, "$ ", ran || "(no command)"),
      t.preview
        ? termOut(`term-out${t.state === "failed" ? " fail" : ""}${held ? " held" : ""}`, t.preview, true)
        : running && (t.live || movable)
          // Still running: the live tail of its output, pinned to its end. The way to the background is on its row.
          ? [t.live ? termOut("term-out live", t.live) : null,
             h("p", { class: "pane-note" }, "Still running — the result replaces this when the command exits.")]
          : t.state === "done" || t.state === "failed" ? h("div", { class: "term-none" }, t.noResult ? "The output was not kept." : "No output.") : null);
    const kind = t.card?.title || (running ? "Running" : t.state === "declined" ? "Declined" : t.state === "vetoed" ? "Vetoed" : t.state === "refused" ? "Refused" : "Ran");
    const why = refusedWhy(t);
    const rest = [code, facts, why].filter(Boolean);
    const secondary = [command, ...rest].filter(Boolean).join(" · ");
    // While it runs, its seconds after its words, never cut with a long command's, and past OFFER_AFTER_MS its Run in
    // background where it may move (the Designer's of 10-28). Its card stands folded however long it runs; one the
    // person opened stays open at its end while its turn runs (`heldOpen`).
    const after = running ? [ticking(h("span", { class: "tool-clock" }), Number(t.at) || Date.now(), runningFor), movable ? offerWhenLong(backgroundButton(String(moveRun), String(t.id)), t) : null] : undefined;
    return toolRow({ ...base, icon: ICONS.terminal, kind, primary: [], secondary, after, body, open: held });
  }
  if (k === "ask") {
    const q = line(subj ?? a.question);
    // A coding agent's question carries the person's answer in words once it settles (HarnessV3-ACP AC2-4).
    const body = h("div", { class: "ask-card" },
      h("div", { class: "ask-q" }, ...(q ? inlineMarks(h, q) : ["(no question)"])),
      h("div", { class: "ask-a" }, askAnswerWords(t, running)));
    return toolRow({ ...base, icon: ICONS.circleHelp, kind: t.card?.title || (running ? "Asking questions" : "Asked"), primary: [], secondary: q ? inlineMarks(h, q) : "", body });
  }
  if (k === "todo") {
    // A plan call from any vocabulary: the item list with status icons, the card's title over it.
    const items = Array.isArray(a.items) ? a.items : Array.isArray(a.todos) ? a.todos : [];
    return toolRow({ ...base, icon: ICONS.listTodo, kind: t.card?.title || (running ? "Planning" : "Planned"), primary: [subj || `${items.length} item${items.length === 1 ? "" : "s"}`], secondary: facts, body: items.length ? planItems(items, !!o.live) : null });
  }
  // A plan an agent proposed for the person to accept (HarnessV3-ACP AC2-4): its name; opened, its overview, the plan
  // itself and its to-dos, as its question carried them, then the person's answer.
  if (k === "proposal") {
    const p = t.form?.plan || null;
    const said = planBody(p);
    const text = said.trim() ? h("div", { class: "sub-prompt sub-report a-md" }) : null;
    if (text) setHtml(text, mdChat(said, null).out);
    const todos = Array.isArray(p?.todos) ? p.todos : [];
    const body = p || t.answer
      ? h("div", { class: "sub-card" },
          p?.overview ? h("div", { class: "sub-prompt" }, String(p.overview)) : null,
          text,
          todos.length ? planItems(todos) : null,
          h("div", { class: "ask-a" }, t.answer || (running ? "Waiting for your answer" : "No answer recorded")))
      : undefined;
    // Its line says the person's answer; a plan sent back (Claude's, its call declined) failed nothing, so no chip says
    // it again as a denial (HarnessV3-ACP AC3-3).
    const status = t.state === "declined" && t.answer ? undefined : base.status;
    return toolRow({ ...base, status, icon: ICONS.listTodo, kind: t.card?.title || "Propose a plan", primary: subj ? [line(subj)] : [], secondary: t.answer ? line(t.answer) : facts, body });
  }
  if (k === "web") {
    const shots = picturesPart(t, pictureAltOf(t));
    return toolRow({
      ...base, icon: ICONS.globe, kind: t.card?.title || (running ? "Fetching" : "Fetched"),
      primary: subj ? [line(subj)] : [], secondary: facts,
      body: shots ? h("div", { class: "term-card picture-card" }, shots, ...(t.preview ? previewParts(t) : [])) : t.preview ? previewBody(t) : undefined,
      open: pictured(t),
    });
  }
  // The agent's own stop of a sub-agent (`SUBAGENT_STOP`): no launch and no follow-up, so no sub-agent's card — whom it
  // stopped, and Filament's answer behind the row. One that stopped nothing is named by what it asked, as a memory
  // call is: its status says how it ended.
  if (k === "subagent" && t.card?.title === SUBAGENT_STOP) {
    const said = t.preview ? h("div", { class: "term-card" }, h("div", { class: "sub-label" }, "Filament's answer"), ...previewParts(t)) : undefined;
    return toolRow({ ...base, icon: ICONS.bot, kind: running ? "Stopping sub-agent" : base.status ? SUBAGENT_STOP : "Stopped sub-agent", primary: subj ? [line(subj)] : [], secondary: facts, ...(said ? { body: said } : {}) });
  }
  if (k === "subagent" && name !== "delegate_read") return subagentRow(t, base, o);
  if (k === "image") return imageRow(t, base, o.turnAt?.there);
  // A visual (HarnessV4_Visuals_Plan §5): one line each in the work — the picture itself stands in the answer. A drawing
  // refused says why on its line (VC-50); the guide names the kinds it was read for.
  if (k === "visual" || k === "visual-guide") {
    const refused = t.state === "failed" && t.preview ? line(String(t.preview)) : "";
    const guide = k === "visual-guide";
    return toolRow({
      ...base,
      icon: guide ? ICONS.notepadText : ICONS.palette,
      kind: guide ? (running ? "Reading the visual guide" : "Read the visual guide") : running ? "Drawing" : t.state === "failed" ? "Not drawn" : "Drew",
      primary: subj ? [line(subj)] : [],
      secondary: refused || facts,
    });
  }
  if (name === "delegate_read" || name === "task") {
    const brief = line(subj ?? a.brief ?? "");
    const body = h("div", { class: "sub-card" },
      h("div", { class: "sub-label" }, "Prompt"),
      h("div", { class: "sub-prompt" }, brief || "(no prompt recorded)"));
    return toolRow({ ...base, icon: ICONS.bot, kind: "SubAgent", primary: brief ? [brief] : [], secondary: facts, body, open: running });
  }
  // The loop's own pause for its background sub-agents (HarnessV3-Responsiveness R5): it ends when a report lands,
  // a message arrives or the time is up, so while it runs the most it will wait is what it says.
  if (name === "wait") {
    const limit = Number(a.seconds) > 0 ? `up to ${Math.round(Number(a.seconds))} s` : "";
    const took = t.ms != null && t.ms >= 1000 ? `${(t.ms / 1000).toFixed(1)}s` : "";
    return toolRow({ ...base, icon: ICONS.timer, kind: running ? "Waiting for agents" : "Waited for agents", primary: [], secondary: running ? limit : took });
  }
  // The agent opens its sealed envelopes (HarnessV4_Envelopes_Plan EN5) — Filament's own tool, or a coding agent's call of
  // it over Filament's MCP server: how many it asked for, and what it read, whole, behind the row.
  if (name === "envelope" || name.endsWith("__envelope")) {
    const read = t.preview ? h("div", { class: "term-card" }, h("div", { class: "sub-label" }, "What it read"), ...previewParts(t)) : undefined;
    // A picture another agent drew, opened by its name (HarnessV4_DesignPass_Plan UX1).
    if (typeof a.picture === "string" && a.picture.trim())
      return toolRow({ ...base, icon: ICONS.mailOpen, kind: running ? "Opening a picture" : "Opened a picture", primary: [a.picture.trim()], secondary: facts, ...(read ? { body: read } : {}) });
    // A letter to another chat, to a sub-agent of the chat's or from one to the agent that launched it (`lead`), or a
    // reply to one (app/letters.js): its subject or the letter it answers, and Filament's answer behind the row — where
    // it went, or why it was not sent.
    const answering = a.answer != null && String(a.answer).trim() !== "";
    if (answering || (a.to != null && String(a.to).trim() !== "")) {
      const refused = String(t.preview || "").startsWith("Not sent");
      const said = t.preview ? h("div", { class: "term-card" }, h("div", { class: "sub-label" }, "Filament's answer"), ...previewParts(t)) : undefined;
      const kind = refused ? "Letter not sent" : answering ? (running ? "Replying to a letter" : "Replied to a letter") : running ? "Writing a letter" : "Wrote a letter";
      const primary = answering ? [String(a.answer).trim()] : [String(a.subject || "").trim() || String(a.to).trim()];
      // To whom, as Filament's answer names the chat — its title, quotes and all, up to the id after it — or the lead,
      // else its id.
      const named = /\bto the chat "(.*)" \([A-Za-z0-9_-]{1,64}\)/.exec(String(t.preview || ""))?.[1];
      const target = String(a.to ?? "").trim();
      const lead = /^Sent: letter \S+ to your team's lead\./.test(String(t.preview || "")) ? "to its team's lead" : "to the main agent";
      const to = named ? `to “${named}”` : answering ? "" : target.toLowerCase() === "lead" ? lead : /^sa_[0-9a-f]+$/i.test(target) ? `to sub-agent ${target}` : `to chat ${target}`;
      return toolRow({ ...base, icon: ICONS.mail, kind, primary, secondary: to || facts, ...(said ? { body: said } : {}) });
    }
    const n = Math.floor(Number(a.count) || 1);
    const asked = a.all === true ? "every one still sealed" : n > 1 ? `the ${n} oldest` : "the oldest";
    return toolRow({ ...base, icon: ICONS.mailOpen, kind: running ? "Opening envelopes" : "Opened envelopes", primary: [asked], secondary: facts, ...(read ? { body: read } : {}) });
  }
  // The task graph's call (HarnessV4_TaskGraphEasy_Plan E40, TG3) — Filament's own tool, or a coding agent's call of it
  // over Filament's MCP server: what it did and to which tasks, in words; opened, those tasks and Filament's answer.
  if (k === "tasks" || /^(mcp__filament__)?tasks$/.test(name)) return tasksRow(t, base, a, facts);
  if (/^(mcp__filament__)?thread$/.test(name)) return threadRow(t, base, a, facts);
  const made = spaceCall(t) ? proposedOf(t) : null;
  if (made) return proposalRow(t, base, made, facts, o.drawn?.get(`call:${t.id}`)?.row || null);
  const shown = line(typeof t.args === "string" ? t.args : JSON.stringify(a));
  // Claude desktop's own artifacts, in a chat imported from Claude Code (HarnessV4_Artifacts_Plan AFC-150..AFC-153):
  // kept on claude.ai, never here. The row names the call and links the page there; opened, exactly what arrived.
  if (k === "claude-artifact") {
    const link = claudeArtifactLink(t);
    const said = subj && subj !== link ? line(subj) : "";
    const out = link ? h("a", { class: "tool-link", href: link, target: "_blank", rel: "noopener noreferrer", title: "Open it on claude.ai, in your browser", onclick: (/** @type {Event} */ e) => e.stopPropagation() }, link.replace(/^https:\/\//, "")) : null;
    return toolRow({ ...base, icon: ICONS.appWindow, kind: t.card?.title || "Artifact on claude.ai", primary: [said ? h("span", {}, said) : null, out].filter((x) => !!x), secondary: facts, body: arrivedBody(t, shown) });
  }
  // The generic card: the tool's own name (or the card's title), the subject it names, its arguments where they say
  // more, and a details body of exactly what arrived (the parameters, the result), collapsible, never a guess. A card
  // whose title is all it says (an agent's own title for a call it names no tool for) is cut short like a sentence.
  const title = t.card?.title || t.name || "tool";
  const said = subj && subj !== title ? line(subj) : "";
  return toolRow({ ...base, icon: ICONS.wrench, kind: title, fit: !said, primary: said ? [said] : [], secondary: shown !== said && shown !== title ? shown : "", body: arrivedBody(t, shown), open: pictured(t) });
}

/**
 * A thread the agent started (core/threads.js) — Filament's own tool, or a coding agent's call of it over Filament's MCP
 * server: the thread by its title, its link opening it, the model it runs on and where; a refusal says why on its line;
 * opened, Filament's answer whole, and the brief it was given where the call came whole.
 * @param {any} t @param {any} base @param {any} a @param {string} facts
 */
export function threadRow(t, base, a, facts) {
  const said = String(t.preview || "");
  // Where it works, then how its folder came to it, as the tool says it (thread-tool.js `whereWords`): a new project —
  // the person allowed, or made unasked —, or another folder the person allowed.
  const m = /^Started the thread "(.*)" \(([A-Za-z0-9_-]{1,64})\) on (\S+)(?: at (\S+) effort)?(?: in (.+?)(, a new project(?: the person allowed| made unasked as this chat's mode lets it))?(?:, which the person allowed)?)?: it reads your brief now\./.exec(said);
  // A refusal as the loop hands it back ("Error: Not started: …") or as the tool says it.
  const why = said.replace(/^Error: /, "").replace(/^Not started: /, "");
  const refused = t.state === "failed" || why !== said;
  const title = m?.[1] || String(a.title || "").trim() || (t.card?.kind === "thread" ? String(t.card.subject || "") : "") || (typeof t.args === "string" ? line(t.args) : "");
  const kind = refused ? "Thread not started" : t.state === "running" ? "Starting a thread" : "Started a thread";
  // Its press opens the thread (app.js `chatLinks`), and leaves the row folded as it was.
  const open = m ? chatLinkEl(title || "the thread", m[2]) : null;
  open?.addEventListener("click", (e) => e.stopPropagation());
  const leaf = m?.[5] ? String(m[5]).split(/[\\/]/).filter(Boolean).pop() || m[5] : "";
  const where = m ? [m[3], m[4] ? `${m[4]} effort` : "", leaf ? `in ${leaf}${m[6] ? ", a new project" : ""}` : ""].filter(Boolean).join(" · ") : "";
  const brief = typeof a.brief === "string" && a.brief.trim() ? a.brief.trim() : "";
  const body = said || brief
    ? h("div", { class: "term-card" },
        ...(brief ? [h("div", { class: "sub-label" }, "Its brief"), h("div", { class: "sub-prompt" }, brief)] : []),
        ...(said ? [h("div", { class: "sub-label" }, "Filament's answer"), ...previewParts(t)] : []))
    : undefined;
  return toolRow({
    ...base, icon: ICONS.messagesSquare, kind,
    primary: open ? [open] : title ? [title] : [],
    secondary: refused ? line(why) || facts : where || facts,
    ...(body ? { body } : {}),
  });
}

/**
 * A routine or a watcher the agent proposed or changed with Filament's space tool — its loop's call, or a coding
 * agent's over Filament's MCP server —, proposed right in the chat (the owner's of 11-12): its row says what the call
 * did and names it, opened Filament's answer; under it, folded or not, the card that switches it on (routine-card.js).
 * Drawn again, its row is drawn into the one that stands and the card stays where it is, never out of the page: a
 * field of its sheet keeps its focus.
 * @param {any} t @param {any} base @param {import("../routine-card.js").Proposed} made @param {string} facts
 * @param {Element | null} [stands]  the call's row as it stands
 */
export function proposalRow(t, base, made, facts, stands = null) {
  const title = t.card?.subject != null ? String(t.card.subject).trim() : "";
  const what = made.watcher ? "a watcher" : "a routine";
  const said = t.preview ? h("div", { class: "term-card" }, h("div", { class: "sub-label" }, "Filament's answer"), ...previewParts(t)) : undefined;
  const row = toolRow({
    ...base, icon: made.watcher ? ICONS.eye : ICONS.clock3,
    kind: made.change ? `Changed ${what}` : `Proposed ${what}`,
    primary: title ? [line(title)] : [],
    secondary: facts,
    ...(said ? { body: said } : {}),
  });
  const card = routineCard(made, String(t.id));
  const key = `rp:${t.id}`;
  if (stands?.classList.contains("rp-call") && stands.getAttribute("data-key") === key) {
    morph(stands.children[0], row);
    if (stands.children[1] !== card) stands.children[1]?.replaceWith(card);
    return stands;
  }
  return h("div", { class: "rp-call", "data-key": key, "data-self": "" }, row, card);
}

/**
 * The task graph's call as a row of words (HarnessV4_TaskGraphEasy_Plan E40, TG3): the server's card says what it did
 * and to which tasks (core/tool-vocab.js); where the call came whole — a coding agent's — the tasks it names, a line
 * each; then Filament's answer. Never its arguments as they came: the Plan tab draws the graph itself.
 * @param {any} t @param {any} base @param {any} a  the call's arguments: an object where it came whole, else the loop's line
 * @param {string} facts
 */
function tasksRow(t, base, a, facts) {
  const title = t.card?.kind === "tasks" ? t.card.title : "Task graph";
  const subj = t.card?.kind === "tasks" ? String(t.card.subject || "") : typeof t.args === "string" ? line(t.args) : "";
  let list = a && typeof a === "object" ? a.tasks : null;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = null;
    }
  }
  const tasks = (Array.isArray(list) ? list : list && typeof list === "object" ? [list] : []).filter((x) => x && typeof x === "object");
  /** One task's line: its id and name, then what else the call says of it. @param {any} x */
  const taskLine = (x) => {
    const given = x.needs ?? x.depends_on ?? x.dependencies ?? x.deps ?? x.after ?? x.blocked_by;
    const needs = Array.isArray(given) ? given : typeof given === "string" ? [given] : [];
    const writes = Array.isArray(x.writes) ? x.writes : [];
    const check = Array.isArray(x.check) ? x.check : [];
    const more = [x.by && x.by !== "you" ? `by ${x.by}` : "", needs.length ? `needs ${needs.join(", ")}` : "", writes.length ? `writes ${writes.join(", ")}` : "", check.length ? `check ${check.join("; ")}` : "", x.acceptance ? `done when ${x.acceptance}` : ""].filter(Boolean);
    return h("div", { class: "plan-item" }, h("span", { class: "tg-row-id" }, String(x.id ?? "?")), h("span", {}, `${x.name ?? x.title ?? ""}${more.length ? ` — ${more.join(" · ")}` : ""}`));
  };
  const body = tasks.length || t.preview
    ? h("div", { class: "term-card" },
        ...(tasks.length ? [h("div", { class: "sub-label" }, tasks.length === 1 ? "The task" : `The ${tasks.length} tasks`), h("div", { class: "plan-card-body" }, ...tasks.map(taskLine))] : []),
        ...(t.preview ? [h("div", { class: "sub-label" }, "Filament's answer"), ...previewParts(t)] : []))
    : undefined;
  return toolRow({ ...base, icon: ICONS.network, kind: title, primary: subj ? [line(subj)] : [], secondary: facts, body });
}

/**
 * A call's body of exactly what arrived: a tool's pictures first (an MCP server's screenshot, HarnessV4_Tasks U9),
 * its parameters, its result. @param {any} t @param {string} shown  its parameters, as one line
 */
function arrivedBody(t, shown) {
  const shots = picturesPart(t, pictureAltOf(t));
  return h("div", { class: "term-card" },
    ...(shots ? [shots] : []),
    ...(shown || !t.preview ? [h("div", { class: "sub-label" }, "Parameters"), h("pre", { class: "term-cmd" }, shown || "(none)")] : []),
    ...(t.preview ? [h("div", { class: "sub-label" }, "Result"), ...previewParts(t)] : []));
}

/** A claude.ai artifact's address, whole. */
const CLAUDE_ARTIFACT_URL = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]+$/;
/** The address Claude desktop's publish was told its page went to, on its result's first line. */
const CLAUDE_PUBLISHED = /^Published [^\n]* at (https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]+)/;

/**
 * The claude.ai page a call of Claude desktop's artifact tool names (HarnessV4_Artifacts_Plan AFC-150, AFC-152): the
 * address its publish was told, else the one it was given — a claude.ai artifact's alone; null for any other.
 * Exported for the DOM-free pin. @param {any} t  the call's stub
 * @returns {string | null}
 */
export function claudeArtifactLink(t) {
  const told = t.state === "failed" ? null : CLAUDE_PUBLISHED.exec(String(t.preview || ""))?.[1];
  const url = argsOf(t).url;
  return told || (typeof url === "string" && CLAUDE_ARTIFACT_URL.test(url.trim()) ? url.trim() : null);
}

/**
 * A stub whose open state survives the next rebuild; where the caller keeps its rows (`drawn`), the row itself while
 * the call's record holds — a sub-agent's card is drawn again each time (`DrawnRows`).
 * @param {any} t @param {{ onPrompt?: (t: any) => void, runId?: string, round?: number | null, turnAt?: TurnAt | null, moveRun?: string | null, drawn?: DrawnRows | null, live?: boolean }} [o]
 */
function rememberedStub(t, o = {}) {
  if (o.drawn && t.id != null && !t.sub && kindOfStub(t) !== "subagent") {
    const rev = callRev(t);
    return keptCall(o.drawn, `call:${t.id}`, rev && `${rev}|${optsSig(o)}`, () => rowSig(t, o), () => openStub(t, o));
  }
  // The card of a saved agent the main agent asked reads its marks and answers too: painted again at each drawing, in
  // the card that stands (`subagentRow`).
  if (o.drawn && t.id != null && askedCall(t)) return keptCall(o.drawn, `call:${t.id}`, null, null, () => openStub(t, o));
  if (o.drawn && t.id != null) {
    const rev = callRev(t);
    return keptCall(o.drawn, `call:${t.id}`, rev && `${rev}|${callRev(t.sub)}|${optsSig(o)}|${JSON.stringify(subagentEnd(t))}`, null, () => openStub(t, o));
  }
  return openStub(t, o);
}
/** A sub-agent's end as the session's list says it, where its run's events no longer can (`endFromList`). @param {any} t */
function subagentEnd(t) {
  const told = t.sub || null;
  return endFromList(told, told?.agentId && chipActions.subagentRow ? chipActions.subagentRow(String(told.agentId)) : null, !!chipActions.subagentsKnown?.(), chipActions.subagentLogged, chipActions.subagentCard);
}
/** @param {any} t @param {{ onPrompt?: (t: any) => void, runId?: string, round?: number | null, turnAt?: TurnAt | null, moveRun?: string | null, drawn?: DrawnRows | null, live?: boolean }} o */
function openStub(t, o) {
  const row = stubOf(t, o);
  // An agent's row stands with the line of what it drew under it (`subagentRow`), a proposal's with its card
  // (`proposalRow`).
  const fold = row.classList.contains("sub-drew") || row.classList.contains("rp-call") ? row.children[0] : row;
  if (fold?.tagName === "DETAILS") {
    const det = /** @type {HTMLDetailsElement} */ (fold);
    // An archived call its transcript cut: its whole result read as it opens, let go of as it closes (`wholeResult`).
    const cut = fold === row ? cutResultAt(t, o) : null;
    // An explicit choice (open or collapsed) beats what stubOf set; without one, keep it.
    if (openState.get(t.id) != null) det.open = openState.get(t.id) === true;
    // Only a press on the row is the person's choice: a toggle the page made (a card drawn open), remembered as theirs,
    // would open the card again by itself after it ended. Heard through `on`: a row drawn again into the one that
    // stands hands it these, and a card that stands as itself (a sub-agent's) hears one of each, not one per drawing.
    let pressed = false;
    const summary = det.querySelector("summary");
    if (summary) {
      on(summary, "click", () => { pressed = true; });
      // Enter or Space on the row opens it in its own handler (layout.js toolRow), with no click.
      on(summary, "keydown", (/** @type {KeyboardEvent} */ e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) pressed = true; });
    }
    // The row it toggles is the one that hears it (`e.currentTarget`): the row this drawing made, closed over here, was
    // kept by the row that stands — a twin of every row drawn again (the review of 11-17).
    on(det, "toggle", (/** @type {Event} */ e) => {
      const opened = /** @type {HTMLDetailsElement} */ (e.currentTarget);
      if (pressed) openState.set(t.id, opened.open);
      pressed = false;
      if (cut) wholeResult(opened, t, o, cut);
      callsToggled(opened);
    });
  }
  return row;
}

/**
 * Where an archived call's whole result is read, when its card was sent the head of it alone (`archivedStubs`: the
 * whole length past the preview): its turn and its id. Null for any other — a run's call, whose events carry what they
 * carry, an agent thread's, whose record is its conversation, or one no id names.
 * @param {any} t @param {{ turnAt?: TurnAt | null }} o @returns {{ chain: string, n: number, id: string } | null}
 */
function cutResultAt(t, o) {
  if (t.source !== "archive" || t.id == null || t.idless || !o.turnAt || o.turnAt.agent) return null;
  const preview = String(t.preview || "");
  return preview && Number(t.chars) > preview.length ? { chain: o.turnAt.chain, n: o.turnAt.n, id: String(t.id) } : null;
}

/** What a card whose result was cut holds while it is open, by its row: the body that shows the preview, to go back to
 *  as it closes; the body that shows the whole, while it does; the line under the preview that says the whole is on its
 *  way or why it is not shown; and the read that is the card's own (`asked`: a read a close outran lands nowhere).
 *  @type {WeakMap<Element, { preview: Element, whole: Element | null, line: Element | null, reading: boolean, asked: number }>} */
const wholes = new WeakMap();

/** What a card says where its whole result is not shown, by the server's `why`. */
const NO_WHOLE_RESULT = Object.freeze({
  later: "The rest is not in the turn's record yet: it shows once the turn has written it.",
  absent: "The rest is not in the turn's record: only its head was kept.",
});

/**
 * An archived card whose transcript carried the head of its result alone (the owner's of 11-15: "fold the tool calls
 * such that long text is not held in memory, and clicking that tool call may simply ask for wait until that part is
 * loaded from disk"). Opened, it shows its preview at once with a line that says the whole is being read, then the
 * whole in the preview's place, drawn as the card draws its preview; closed, it goes back to the preview and lets the
 * whole go, so the page holds no whole result it does not show. A read that fails, or a turn whose record does not hold
 * the result yet, leaves the preview and says so; the next open asks again. A card whose body draws no result (a done
 * edit's is its change) asks nothing.
 * @param {HTMLDetailsElement} det @param {any} t @param {{ turnAt?: TurnAt | null }} o @param {{ chain: string, n: number, id: string }} at
 */
function wholeResult(det, t, o, at) {
  let s = wholes.get(det);
  if (!det.open) {
    if (!s) return;
    s.asked++;
    s.reading = false;
    s.line?.remove();
    s.line = null;
    if (s.whole) s.whole.replaceWith(s.preview);
    s.whole = null;
    return;
  }
  if (!s) {
    // The body `toolRow` put after the row's summary.
    const body = det.children[1];
    if (!body?.querySelector("[data-result]")) return;
    wholes.set(det, (s = { preview: body, whole: null, line: null, reading: false, asked: 0 }));
  }
  if (s.whole || s.reading) return;
  const state = s;
  const asked = ++state.asked;
  state.reading = true;
  state.line?.remove();
  const reading = h("div", { class: "tk-wait", role: "status" }, h("span", { class: "tk-spin", "aria-hidden": "true", html: ICONS.loader }), h("span", {}, "Reading the whole result…"));
  state.preview.append(reading);
  state.line = reading;
  void readResult(at).then((r) => {
    if (state.asked !== asked || !det.open) return;
    state.reading = false;
    state.line?.remove();
    state.line = null;
    const drawn = r.ok ? stubOf({ ...t, preview: r.result, chars: r.cut ? r.chars : r.result.length }, o) : null;
    const whole = drawn?.tagName === "DETAILS" ? drawn.children[1] : null;
    if (whole) {
      state.preview.replaceWith(whole);
      state.whole = whole;
      return;
    }
    const why = /** @type {keyof typeof NO_WHOLE_RESULT} */ (r.ok ? "" : r.why);
    const note = h("p", { class: "pane-note" }, (!r.ok && r.status === 404 && NO_WHOLE_RESULT[why]) || `The whole result could not be read${!r.ok && r.error ? `: ${r.error}` : ""}.`);
    state.preview.append(note);
    state.line = note;
  });
}

/**
 * A call's whole result from its turn's record (`GET /sessions/:id/turns/:n/calls/:call/result`), or why not: the
 * answer's status, its `why` and its words, or the read's failure.
 * @param {{ chain: string, n: number, id: string }} at
 * @returns {Promise<{ ok: true, result: string, chars: number, cut: boolean } | { ok: false, status: number, why: string, error: string }>}
 */
async function readResult(at) {
  try {
    const r = await fetch(`/api/sessions/${encodeURIComponent(at.chain)}/turns/${at.n}/calls/${encodeURIComponent(at.id)}/result`, { headers: { "x-filament-ui": "1" } });
    const j = await r.json().catch(() => null);
    if (r.ok && typeof j?.result === "string") return { ok: true, result: j.result, chars: Number(j.chars) || j.result.length, cut: j.cut === true };
    return { ok: false, status: r.status, why: String(j?.why || ""), error: String(j?.error || "") };
  } catch (e) {
    return { ok: false, status: 0, why: "", error: String(/** @type {any} */ (e)?.message || e) };
  }
}
function groupSummary(tools, family) {
  if (family === "explore") {
    const kindOf = (t) => t.card?.kind || NAME_KIND[String(t.name || "").toLowerCase()];
    const files = tools.filter((t) => kindOf(t) === "read").length;
    const searches = tools.length - files;
    return [files ? `${files} file${files === 1 ? "" : "s"}` : "", searches ? `${searches} search${searches === 1 ? "" : "es"}` : ""].filter(Boolean).join(" · ");
  }
  if (family === "changes") {
    const files = new Set(tools.map((t) => t.card?.subject ?? argsOf(t).path).filter(Boolean));
    const n = files.size || tools.length;
    const added = tools.reduce((s, t) => s + (Number(t.added) || 0), 0);
    const removed = tools.reduce((s, t) => s + (Number(t.removed) || 0), 0);
    const counts = [added ? `+${added}` : "", removed ? `−${removed}` : ""].filter(Boolean).join(" ");
    return `${n} file${n === 1 ? "" : "s"}${counts ? ` ${counts}` : ""}`;
  }
  const failed = tools.filter((t) => t.state === "failed").length;
  return [`${tools.length} command${tools.length === 1 ? "" : "s"}`, failed ? `${failed} failed` : ""].filter(Boolean).join(" · ");
}

/**
 * A call with no end of its own: one that runs, and one its run's end left running — cut off, or a background
 * sub-agent's that its turn follows no longer (lib/labels.js alignEvents, HarnessV4_Tasks U1). It never joins a group:
 * a running one streams alone, and the call a turn broke at is not folded under "ran 3 commands".
 * @param {{ state?: string }} t
 */
const endless = (t) => t.state === "running" || t.state === "cut" || t.state === "unfollowed";

/** A call that shows pictures (HarnessV4_Tasks U9): it never joins a group, which would fold them away. @param {any} t */
const pictured = (t) => Array.isArray(t?.images) && t.images.length > 0;

/** Filament's own tools with rows of their own: the task graph's and the wait for sub-agents. */
const OWN_TOOLS = new Set(["tasks", "report", "wait"]);

/**
 * Whether a finished call may join a work row (AC1-6): a hand's call whose family groups, the web's, an MCP server's,
 * a tool Filament does not know. Never a call with no end (`endless`), one that shows pictures (`pictured`), a sub-agent,
 * a plan, a question, an image, memory
 * or Filament's own tools: each has a row that says what it is.
 * @param {any} t @param {(family: string) => boolean} on @param {(t: any) => boolean} [alone]
 */
function joinsWork(t, on, alone = () => false) {
  if (endless(t) || pictured(t) || alone(t)) return false;
  const family = familyOf(t);
  if (family) return on(family);
  const kind = kindOfStub(t);
  const name = String(t.name || "").toLowerCase();
  if (kind === "web" || kind === "mcp") return true;
  return (kind === "other" || kind === null) && !OWN_TOOLS.has(name) && !name.startsWith("filament_");
}

/**
 * Where the groups fall in a box's calls. Pure: a family's run is consecutive completed stubs of one family, a group
 * at length 2. Between the family runs, two or more finished calls of mixed kinds make a work run (`family: "work"`,
 * AC1-6). A stub with no end (`endless`) never joins one — a running one streams alone until it ends — nor one that
 * shows pictures (`pictured`, HarnessV4_Tasks U9). `toggles` (explore/terminal/changes) turns
 * a family's grouping off, its calls' place in a work run too; without it every family groups.
 * `alone`: a call that stands alone besides those — a command whose card the person opened as it ran, while its turn
 * runs (`heldOpen`).
 * @param {{ name: string, state: string, card?: any }[]} tools
 * @param {{ explore?: boolean, terminal?: boolean, changes?: boolean }} [toggles]
 * @param {(t: any) => boolean} [alone]
 * @returns {{ start: number, length: number, family: string }[]}
 */
export function groupRuns(tools, toggles, alone = () => false) {
  const on = (/** @type {string} */ f) => !toggles || /** @type {Record<string, any>} */ (toggles)[f] !== false;
  const apart = (/** @type {any} */ t) => endless(t) || pictured(t) || alone(t);
  /** @type {{ start: number, length: number, family: string }[]} */
  const runs = [];
  let i = 0;
  while (i < tools.length) {
    const family = familyOf(tools[i]);
    if (!family || !on(family) || apart(tools[i])) { i++; continue; }
    let j = i + 1;
    while (j < tools.length && familyOf(tools[j]) === family && !apart(tools[j])) j++;
    if (j - i >= 2) runs.push({ start: i, length: j - i, family });
    i = j;
  }
  const grouped = new Set(runs.flatMap((r) => Array.from({ length: r.length }, (_, k) => r.start + k)));
  /** @type {{ start: number, length: number, family: string }[]} */
  const work = [];
  i = 0;
  while (i < tools.length) {
    if (grouped.has(i) || !joinsWork(tools[i], on, alone)) { i++; continue; }
    let j = i + 1;
    while (j < tools.length && !grouped.has(j) && joinsWork(tools[j], on, alone)) j++;
    if (j - i >= 2) work.push({ start: i, length: j - i, family: "work" });
    i = j;
  }
  return [...runs, ...work].sort((a, b) => a.start - b.start);
}

/** What a call did, for a work row's sentence. @param {any} t */
function workCategory(t) {
  const kind = kindOfStub(t);
  if (kind === "read") return "read";
  if (kind === "search" || kind === "list") return "search";
  if (kind === "write" || kind === "edit") return "change";
  if (kind === "shell") return "command";
  if (kind === "web") return t.card?.title === "Search the web" || String(t.name).toLowerCase() === "web_search" ? "web" : "fetch";
  // Filament's mcp tool looking for a server's tools or loading them (E49), and Claude Code's ToolSearch doing the same;
  // the mcp tool's call of one is that tool's own.
  if (t.card?.title === "Load tools" || t.card?.title === "Look for tools") return "door";
  if (kind === "mcp") return String(t.name).toLowerCase() === "mcp" ? "door" : "mcp";
  return "other";
}
/** Which of a work row's categories its sentence names first: what changed something before what looked. */
const WORK_RANK = { change: 0, command: 0, read: 1, search: 1, fetch: 1, web: 1, mcp: 1, door: 1, other: 2 };

/** "once", "twice", "3 times". @param {number} n */
const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
/** @param {number} n @param {string} one @param {string} [many] */
const counted = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One category's words. @param {string} key @param {any[]} calls */
function workWords(key, calls) {
  const files = () => new Set(calls.map((t) => t.card?.subject ?? argsOf(t).path).filter(Boolean)).size || calls.length;
  if (key === "read") return `read ${counted(files(), "file")}`;
  if (key === "change") return `changed ${counted(files(), "file")}`;
  if (key === "search") return `searched ${times(calls.length)}`;
  if (key === "command") return `ran ${counted(calls.length, "command")}`;
  if (key === "fetch") return `fetched ${counted(calls.length, "page")}`;
  if (key === "web") return `searched the web ${times(calls.length)}`;
  if (key === "door") {
    const loads = calls.filter((t) => t.card?.title === "Load tools");
    const n = loads.reduce((sum, t) => sum + (String(t.card?.subject || "").split(", ").filter(Boolean).length || 1), 0);
    return loads.length ? `loaded ${counted(n, "tool")}` : `looked for tools ${times(calls.length)}`;
  }
  if (key === "mcp") {
    const servers = [...new Set(calls.map((t) => /^mcp__(.+?)__/.exec(String(t.name))?.[1] || "an MCP server"))];
    return `used ${servers.length > 2 ? `${servers.slice(0, 2).join(", ")} and ${counted(servers.length - 2, "more server")}` : servers.join(" and ")}`;
  }
  return `used ${counted(calls.length, "tool")}`;
}

/**
 * A work row's sentence (AC1-6): what its calls did, the two kinds that matter most named — a change or
 * a command before a read — in the order they first happened, an MCP server's first; the rest counted. "Read 3 files
 * and ran 2 commands"; "Used github, changed 1 file, and made 2 other calls".
 * @param {any[]} tools
 * @returns {string}
 */
export function workSentence(tools) {
  /** @type {Map<string, { key: string, rank: number, first: number, calls: any[] }>} */
  const cats = new Map();
  tools.forEach((t, i) => {
    const key = workCategory(t);
    const c = cats.get(key) || { key, rank: /** @type {Record<string, number>} */ (WORK_RANK)[key] ?? 2, first: i, calls: [] };
    c.calls.push(t);
    cats.set(key, c);
  });
  const named = [...cats.values()].sort((a, b) => a.rank - b.rank || a.first - b.first).slice(0, 2)
    .sort((a, b) => (a.key === "mcp" ? -1 : b.key === "mcp" ? 1 : a.first - b.first));
  const others = tools.length - named.reduce((n, c) => n + c.calls.length, 0);
  const parts = named.map((c) => workWords(c.key, c.calls));
  if (others) parts.push(`made ${others} other call${others === 1 ? "" : "s"}`);
  const s = parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * One box's rows: consecutive completed stubs of one family collapse into a group, and calls of mixed kinds between
 * the groups into one work row; a live stub streams alone. `asksApart`: the calls whose cards stand apart are left
 * out — a saved agent asked, a helper that drew (`apartCall`) — a settled turn draws them outside its fold (`askedRows`).
 * `drawn`: the rows the caller drew last, kept while their calls' records hold (`DrawnRows`).
 * @param {any} cell
 * @param {{ onPrompt?: (t: any) => void, runId?: string, round?: number | null, turnAt?: TurnAt | null, moveRun?: string | null, asksApart?: boolean, drawn?: DrawnRows | null, live?: boolean }} [o]
 * @returns {HTMLElement[]}
 */
export function roundRows(cell, o = {}) {
  // The round rides to each stub, so an edit's diff and counts are its own round's.
  o = { ...o, round: Number.isInteger(cell.round) ? cell.round : null };
  // A plan call (the loop's `plan`, any vocabulary's: Claude's TaskCreate) is shown as the Todo card built from the
  // run's newest `plan` event; its stub would say the same thing twice. So is one whose round's plan a later round's
  // card shows (`planLater`, labels.js). The stub stays when no plan event landed (a plan call that failed), so the
  // call is never invisible.
  const planCall = (/** @type {any} */ t) => t.card?.kind === "todo" || String(t.name).toLowerCase() === "plan";
  const carded = !!(cell.plan?.length || cell.planLater);
  const tools = cell.order.map((id) => cell.tools.get(id)).filter((t) => t && !(carded && planCall(t)) && !(o.asksApart && apartCall(t)));
  const toggles = groupToggles();
  /** @type {HTMLElement[]} */
  const rows = [];
  // The round's groups, found once (they were found again from each call on: a sub-agent's hundreds of calls made
  // every frame of its card quadratic, the performance Hunter's find of 10-25). The groups of what follows a group
  // are the ones the whole finds there.
  const groups = new Map(groupRuns(tools, toggles, o.live ? (t) => heldOpen(t, true) : undefined).map((g) => [g.start, g]));
  let i = 0;
  while (i < tools.length) {
    const t = tools[i];
    const found = groups.get(i);
    const run = found ? tools.slice(i, i + found.length) : [t];
    const family = found?.family || null;
    if (run.length >= 2) {
      const failed = run.filter((x) => x.state === "failed").length;
      const kids = run.map((x) => rememberedStub(x, o));
      // The group's open state lives under its OWN key: sharing the first child's made opening the child stamp the
      // group (and a rebuild then reopened the group, which stamped the child — cards opening by themselves).
      const gk = `group:${run[0].id}`;
      // A work run's row is its sentence: what its calls did, in words.
      const work = family === "work";
      /** The box of its rows this drawing made — empty: they are rows of their own, placed in the box that stands once
       *  the group is drawn (a drawing's box would take them off the page). @type {HTMLElement | null} */
      let box = null;
      // Kept while its rows are the same drawings (`DrawnRows`, `drawingOf`): its line is drawn from their calls.
      const group = keptRow(o.drawn, gk, `${family}|${kids.map(drawingOf).join(",")}`, () => {
        const made = toolRow({
          icon: work ? ICONS.layers : family === "terminal" ? ICONS.terminal : family === "changes" ? ICONS.pencil : ICONS.search,
          kind: work ? workSentence(run) : family === "terminal" ? "Terminal" : family === "changes" ? "Changes" : "Explore",
          fit: work,
          tone: family || "explore",
          primary: work ? [] : [groupSummary(run, /** @type {any} */ (family))],
          status: failed ? { word: `${failed} failed`, title: "a call inside the group failed" } : undefined,
          body: (box = h("div", { class: "tool-children", "data-placed": "" })),
          open: openState.get(gk) || false,
        });
        on(made, "toggle", keepsOpen(gk));
        return made;
      });
      const drawnBox = /** @type {HTMLElement | null} */ (box);
      if (drawnBox) placeChildren(standing(drawnBox), kids);
      rows.push(group);
      i += run.length;
    } else {
      rows.push(rememberedStub(t, o));
      i++;
    }
  }
  return rows;
}

/**
 * The cards of the saved agents a turn's main agent asked, in the order it asked them (HarnessV4_Tasks E15 step 3),
 * and of the helpers it launched that drew (HarnessV4_Visuals_Plan VS-D50). A settled turn draws them apart from its
 * rounds' rows: each is a view the developer may overrule, or holds a picture, so it stays in view when the turn's
 * work folds.
 * @param {readonly any[]} cells  the turn's rounds, in order
 * @param {{ onPrompt?: (t: any) => void, runId?: string, turnAt?: TurnAt | null }} [o]
 * @returns {HTMLElement[]}
 */
export function askedRows(cells, o = {}) {
  return cells.flatMap((cell) =>
    cell.order
      .map((/** @type {string} */ id) => cell.tools.get(id))
      .filter(apartCall)
      .map((/** @type {any} */ t) => rememberedStub(t, { ...o, round: Number.isInteger(cell.round) ? cell.round : null })));
}

/**
 * A transcript turn's tool calls as rows (D8): the cards the server read from the archived work in whatever wire
 * format and vocabulary the turn spoke, grouped like a run's rounds. A turn with a run of its own never comes
 * here — its run's events are richer (diffs, hooks). A call without a recorded result (an interrupted leg) draws
 * done, not running: nothing is still happening in a finished turn.
 * @param {any[]} tools  the transcript turn's `tools`
 * @param {{ onPrompt?: (t: any) => void, key?: string | number, turnAt?: TurnAt | null }} [o]  `key` separates this turn's
 *   id-less calls from another's
 * @returns {HTMLElement[]}
 */
export function archivedRows(tools, o = {}) {
  const stubs = archivedStubs(tools, o);
  const cell = { order: stubs.map((x) => x.id), tools: new Map(stubs.map((x) => [x.id, x])), plan: null };
  return roundRows(/** @type {any} */ (cell), o);
}

/**
 * A transcript turn's tool calls as the stubs `archivedRows` draws (D8), DOM-free: the server's card kept whole (its
 * kind picks the row, `kindOfStub`), the result as the preview, done or failed — never running.
 * @param {any[]} tools  the transcript turn's `tools`
 * @param {{ key?: string | number }} [o]
 */
export function archivedStubs(tools, o = {}) {
  const key = o.key != null ? String(o.key) : "x";
  return (tools || []).map((x, i) => {
    const notRun = !!x.isError && notRunResult(x.result);
    return {
      id: x.id ?? `arch-${key}-${i}`,
      // A call the archive kept no id for: no change of its own can be asked (HarnessV4_Four_Plan E22).
      ...(x.id == null ? { idless: true } : {}),
      name: String(x.name || ""),
      card: x.card || null,
      args: x.input ?? {},
      // A call that never ran reads as it did live: the stub's word and title say it, with no result to show.
      preview: x.result != null && !notRun ? String(x.result) : "",
      // A call with no result recorded (an interrupted leg, a chat from an agent that keeps none) states no size,
      // and its card says the output was not kept, never that there was none (`noResult`).
      chars: x.result == null ? null : notRun ? 0 : x.resultChars || 0,
      ...(x.result == null ? { noResult: true } : {}),
      state: x.isError ? (vetoedResult(x.result) ? "vetoed" : stoppedResult(x.result) ? "stopped" : "failed") : "done",
      ...(notRun ? { notRun: true } : {}),
      // A command the developer sent to the background (HarnessV4_Four_Plan E21), as its answer names its shell.
      ...(!x.isError && movedResult(x.result) ? { background: movedResult(x.result), ...(/^The command ran past its timeout/.test(String(x.result)) ? { movedBy: "timeout" } : {}) } : {}),
      source: "archive",
    };
  });
}

/**
 * What an ask card says under its question: the person's answer. A call read from the archive has it as its result,
 * in the words the agent heard it in; one whose result was never kept says so, never that no answer was given.
 * @param {any} t @param {boolean} running
 */
export function askAnswerWords(t, running) {
  const heard = t?.answer || (t?.source === "archive" ? String(t.preview || "").trim() : "");
  return heard || (running ? "Waiting for your answer" : t?.noResult ? "The answer was not kept." : "No answer provided");
}

/** Whether an archived result is the loop's answer for a call the developer's stop came before (F2 item 12), or the
 *  client's hang-up (the bug report's P5). @param {unknown} result */
export function notRunResult(result) {
  return /^Not run: the (developer stopped the turn|client disconnected) before it ran\.$/.test(String(result ?? ""));
}

/** Whether an archived result is a call the developer vetoed before it ran: Vetoed after a reload, as it was live —
 *  never Failed. @param {unknown} result */
export function vetoedResult(result) {
  return String(result ?? "").startsWith("Not run: the developer objected before it ran");
}

/** The background shell an archived result names as the one the developer sent its command to (the hands' words,
 *  HarnessV4_Four_Plan E21), or its timeout did, or null: drawn In the background after a reload too. @param {unknown} result */
export function movedResult(result) {
  const m = /^(?:The developer sent this command to the background after \d+ seconds?|The command ran past its timeout of [^,]+, so Filament sent it to the background rather than stop it)\. It is still running, as background shell (bg_[0-9a-z]+):/.exec(String(result ?? ""));
  return m ? m[1] : null;
}

/** Whether an archived error result is a command the developer's stop cut, a call a stop, a Force stop or a hang-up
 *  found running (the loop's words, or a coding agent's: app/agent-run.js), or a call the stop kept from running —
 *  drawn softly as Stopped after a reload too, never as a failure (BUG-09). @param {unknown} result */
export function stoppedResult(result) {
  const s = String(result ?? "");
  return (
    /^Error: Command stopped with the turn after \d+ seconds/.test(s) ||
    /^Stopped: the (developer (force-)?stopped the turn|client disconnected) while this call ran/.test(s) ||
    notRunResult(s)
  );
}

/** The plan card (Todo): the current step, N/M, and the list with its status icons. Hidden whole when the
 *  Appearance "Show todos" switch is off, as the page's root says it (`watchTodos`). `live`: its turn runs, and the step
 *  in progress spins (`planIcon`).
 * @param {any[]} items @param {() => void} onPlan @param {boolean} [live] */
export function planCard(items, onPlan, live = false) {
  const done = items.filter((p) => p.status === "done").length;
  const current = items.find((p) => p.status === "doing");
  const body = h("div", { class: "plan-card-body" },
    ...items.map((p) => h("div", { class: `plan-item ${p.status || "pending"}` },
      planIcon(p.status || "pending", live),
      h("span", {}, p.text))));
  const card = toolRow({
    icon: ICONS.listTodo, kind: "Todo",
    primary: [current?.text || items[0]?.text || "plan"],
    secondary: `${done}/${items.length}`,
    body, open: true,
  });
  card.classList.add("todo-card");
  watchTodos();
  return card;
}

/**
 * The Appearance "Show todos" switch, said once on the page's root (`data-hide-todos`), where the stylesheet hides
 * every plan card: no card is kept to repaint. A module that held drawn cards would hold every redrawn turn's whole
 * detached DOM with them, for the page's life.
 */
let todosWatched = false;
const todosOnRoot = () => document.documentElement.toggleAttribute("data-hide-todos", prefs.get("showTodos") === false);
function watchTodos() {
  if (todosWatched) return;
  todosWatched = true;
  todosOnRoot();
  prefs.onChange((key) => {
    if (key === "showTodos") todosOnRoot();
  });
}
