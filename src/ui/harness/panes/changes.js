// @ts-check
// The Changes pane by place (the Designer's of 10-29, on the owner's words of 10-29: "in the changes view i should only
// see agents that are either inside a worktree or have edited a file … what agents are writing where into which
// worktree and what branches and what uncommitted files are there sitting … Need a full revamp"): a summary line, then
// a block a place — your folder, a sub-agent's copy with its Apply, another place this chat wrote; then the other
// chats' worktrees — each with its branch and what sits uncommitted, the agents that wrote there, each with its files,
// and the files no agent's edit wrote. One read, GET /api/git/changes (changes-places.js shapes it), on open, on Read
// again, at a turn's end, as the sub-agents move, as a chat is deleted, and every 30 s while shown — never on the host's
// pulse alone. A file's diff opens under its row, one at a time. It only shows: Apply, Send back to rebase and Stop are
// its actions (GW-D1, GW-D14); a place and a file open in your editor (GW-D25). Each draw is made in place (dom.js
// `morphChildren`): the elements that stood stay, with the newest draw's words and handlers.
import { h, morphChildren, standing } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { pageShown, whenPageShown } from "../lib/page-shown.js";
import { ICONS, icon } from "../lib/icons.js";
import { diffCount, diffView, menu, tooltip } from "../lib/ui.js";
import { richPainter } from "../lib/diff-render.js";
import { editorButton as openButton } from "../lib/editors.js";
import { vendorOf } from "../lib/families.js";
import { ageOf } from "../lib/now.js";
import { kids } from "../widgets/kit.js";
import { createBand } from "./agents-band.js";
import { binaryWords, clockOf, cutWords, dirLeaf, gitWords, splitPatch } from "./changes-data.js";
import { FILES_SHOWN, changesModel, emptyOf, linesWords } from "./changes-places.js";

/**
 * What the pane is handed beside the host's own: the chat's sub-agents and the door to one's thread, the model its agent
 * runs on, and what the copies' Apply reads and does.
 * @typedef {{ chat: any, setBadge?: (n: number) => void, subagents: () => import("../lib/subagents.js").SubagentRow[],
 *   openSubagent: (id: string) => void, model: (chat: any) => string, head?: HTMLElement,
 *   band?: (chat: any) => import("./agents-band.js").BandDoors, now?: () => number }} ChangesCtx
 *   `head`: the tile's place for the pane's own controls (proposal_ux §3.5) — Read again goes there; `band`: a copy's
 *   Apply, an agent's thread, its chat, its stop
 */
/** A file a caller asked to see, by its path in its place. @typedef {{ path: string, place?: string | null, agent?: string }} AskedFile */
/**
 * What the pane keeps for a chat: the last answer, drawn first when it shows again; the file open; the agents whose
 * files were folded or unfolded, those showing all their files, the places whose other changes are open; the file asked for.
 * @typedef {{ answer: any, at: number, open: string | null, agents: Map<string, boolean>, all: Set<string>,
 *   others: Set<string>, ask: AskedFile | null }} View
 */

/** How often the pane on screen reads again with nothing else moving. */
export const READ_EVERY_MS = 30_000;
/** How long a Review › waits for its agent's line to come (the Hunter's of 10-28). */
export const REVIEW_WAIT_MS = 10_000;

/** @type {WeakMap<object, View>} */
const views = new WeakMap();
/** @param {any} chat @returns {View} */
const viewOf = (chat) => {
  let v = views.get(chat);
  if (!v) views.set(chat, (v = { answer: null, at: 0, open: null, agents: new Map(), all: new Set(), others: new Set(), ask: null }));
  return v;
};
/** What a caller asked the pane to show at its next draw. @type {AskedFile | null} */
let asked = null;
/** A sub-agent's line a caller asked to see (`sub:<id>`), and when. */
let askedAgent = /** @type {string | null} */ (null);
let askedAt = 0;
const askedNow = () => {
  if (askedAgent && Date.now() - askedAt > REVIEW_WAIT_MS) askedAgent = null;
  return askedAgent;
};
/** The pane on screen, which the host's pulse and the page's sub-agents' moves draw again. @type {{ chat: any, root: HTMLElement, pulse: () => void, paint: () => void, reveal: (key: string) => boolean, reread: () => void, letGo: () => void } | null} */
let drawn = null;

/**
 * A sub-agent's line open and in view (a card's or a mark's "Review ›"): at once where the pane is on screen, else at
 * its next draw within a few seconds. @param {string} key  `sub:<id>`
 */
export function reviewAgent(key) {
  if (drawn?.root.isConnected && drawn.reveal(key)) return;
  askedAgent = key;
  askedAt = Date.now();
}

/**
 * A file open at the pane's next draw; the caller then opens the pane's tab. The scopes went (the owner's of 10-29):
 * `scope` and `turn` are read no more. @param {{ scope?: string, turn?: any, file?: AskedFile }} o
 */
export function showChanges(o) {
  asked = o.file || null;
}

/** @param {HTMLElement} body @param {ChangesCtx} ctx */
export function renderChanges(body, ctx) {
  const v = viewOf(ctx.chat);
  if (asked) {
    v.ask = asked;
    v.open = null;
    asked = null;
  }
  // One pane on screen: the one before it — the host's draw again, a chat switched — goes, its reads and timers too.
  drawn?.letGo();
  drawn = createPane(body, ctx, v);
}

/** The host's pulse: the pane on screen draws what moved, reading again only when it should; anything else is drawn afresh. @param {HTMLElement} body @param {ChangesCtx} ctx */
export function refreshChanges(body, ctx) {
  if (!drawn || drawn.chat !== ctx.chat || !body.contains(drawn.root)) {
    body.replaceChildren();
    renderChanges(body, ctx);
    return;
  }
  drawn.pulse();
}

/** The pane on screen, drawn again: the chat's sub-agents moved. */
export function paintBand() {
  if (drawn?.root.isConnected) drawn.pulse();
}

/**
 * A chat deleted (the owner's of 11-04: "i deleted that chat but that was still showing in the Changes side bar"): the
 * pane on screen reads again past the server's cache — the worktree only that chat wrote in goes, and its name from the
 * files it wrote. The deleted chat's own pane reads nothing: the chat that takes its place draws its own.
 * @param {string} chain
 */
export function chatDeleted(chain) {
  if (drawn?.root.isConnected && String(drawn.chat?.chainId || "") !== String(chain)) drawn.reread();
}

/** @param {string} s */
const enc = (s) => encodeURIComponent(s);
/** A file's full path in its place, for the editor. @param {string} place @param {string} path */
const absOf = (place, path) => `${String(place).replace(/[\\/]+$/, "")}/${path}`;
/** A file's letter and its colour's class. @param {string} s */
const letterOf = (s) => {
  const letter = ["M", "A", "D", "R", "U"].includes(s) ? s : "M";
  return { letter, cls: { A: "a", M: "m", D: "d", R: "r", U: "u" }[letter] || "m" };
};
/**
 * Its sub-agents as they stand, in one line: what moves the copies' reads — a running one's round too, so its copy's
 * files show as it goes (10-29). @param {readonly any[]} subs
 */
const subsSig = (subs) => subs.map((s) => `${s.id}:${s.status}:${s.status === "running" ? Number(s.progress?.round) || 0 : ""}:${s.work?.sig || ""}:${s.work?.pending || 0}:${s.work?.applied || 0}:${s.rebaseDue ? 1 : 0}`).join("|");
/**
 * Its sub-agents' Applies, in one line: one landing reads past the server's cache, whose answer from just before has
 * none of what it wrote (found reviewing the Changes tab, 10-29). @param {readonly any[]} subs
 */
const appliesSig = (subs) => subs.map((s) => `${s.id}:${s.work?.applied || 0}`).join("|");

/**
 * One draw of the pane for a chat, and its refresh.
 * @param {HTMLElement} body @param {ChangesCtx} ctx @param {View} v
 */
function createPane(body, ctx, v) {
  const chat = ctx.chat;
  // Read at each use: a new chat's first send gives it its chain, and a worktree chat its folder, on the same chat.
  const cwdOf = () => String(chat?.cwd || "");
  const chainOf = () => String(chat?.chainId || "");
  const now = () => (ctx.now ? ctx.now() : Date.now());
  const summary = h("div", { class: "chp-sum", role: "status" });
  const again = h("button", { class: "ghost icon chp-again", type: "button", "aria-label": "Read again", html: ICONS.rotateCcw, onclick: () => { band?.reread(); void load(true); } });
  tooltip(again, { title: () => (v.at ? `Read ${new Date(v.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · Read again` : "Read again") });
  const list = h("div", { class: "chg-list chp-list" });
  if (ctx.head) ctx.head.replaceChildren(again);
  const root = h("div", { class: "chg chp" }, h("div", { class: "chp-top" }, summary, ctx.head ? null : again), list);
  body.append(root);
  const painter = richPainter(list);
  /** An agent's thread, its chat, its stop; a copy's diff and Apply. */
  const doors = ctx.band ? ctx.band(chat) : null;
  let ready = false;
  /** Let go: another pane took its place; what it read after says nothing. */
  let gone = false;
  // A copy's Apply, its rebase and what its Apply did: the band's, drawn here (agents-band.js `workOf`); its dry runs
  // read again on their own only while this pane is on screen.
  const band = doors
    ? createBand({ ...doors, editorButton: (path, what) => openButton(path, what, "chg-open"), repaint: () => { if (ready) paint(); }, shown: () => !gone && root.isConnected })
    : null;
  /** Each file's diff as read, by its key and its counts. @type {Map<string, { sig: string, data: any }>} */
  const diffs = new Map();
  /** What each diff's box on the page holds, as the read's text: the same read again draws nothing. @type {WeakMap<Element, string>} */
  const holds = new WeakMap();
  /** A copy's whole waiting diff, by its sub-agent and its work. @type {Map<string, { sig: string, p: Promise<Map<string, string>> }>} */
  const copyDiffs = new Map();
  let seq = 0;
  let loading = false;
  /** A read of this draw's has answered: what it does not list is not there. */
  let landed = false;
  let error = /** @type {string | null} */ (null);
  let wasLive = !!chat?.live;
  let subsSeen = subsSig(ctx.subagents());
  let appliesSeen = appliesSig(ctx.subagents());
  let drawKey = "";
  /** The pane's own look READ_EVERY_MS after its last read landed, while it shows. @type {any} */
  let every = null;
  /** What waits while the page is out of sight is this draw's pulse. */
  const pulseShown = Symbol("the Changes pane's pulse");

  /** One read of the places; `fresh`, past the server's few seconds' cache. @param {boolean} [fresh] */
  async function load(fresh = false) {
    const cwd = cwdOf();
    const chain = chainOf();
    if (!cwd) return paint();
    const n = ++seq;
    loading = true;
    paint();
    try {
      const got = await api(`/git/changes?cwd=${enc(cwd)}${chain ? `&chain=${enc(chain)}` : ""}${fresh ? "&fresh=1" : ""}`);
      if (n !== seq) return;
      v.answer = got;
      v.at = now();
      error = null;
      landed = true;
    } catch (e) {
      if (n !== seq) return;
      error = String(/** @type {any} */ (e)?.message || e);
    }
    loading = false;
    drawKey = "";
    paint();
    lookLater();
  }

  /**
   * With nothing else moving — no turn's pulse, no sub-agent — the pane looks again on its own every READ_EVERY_MS
   * while it shows, a pulse of its own, which reads once the answer is old. Let go, or off the screen, it stops: a pane
   * drawn again looks for itself.
   */
  function lookLater() {
    clearTimeout(every);
    if (gone) return;
    every = setTimeout(() => {
      every = null;
      if (gone || !root.isConnected) return;
      pulse();
      // Nothing read, its answer not old yet: it looks again later. A read under way looks again as it lands.
      if (!loading) lookLater();
    }, READ_EVERY_MS + 50);
    every?.unref?.();
  }

  const modelNow = () =>
    changesModel(v.answer, { chain: chainOf(), live: !!chat?.live, model: ctx.model(chat), subs: ctx.subagents(), clock: clockOf });

  /**
   * The pane drawn in place: a read landing, the per-minute draw and the band's as a dry run lands keep the elements
   * that stood — a block, an agent's line and its ⋯, a file's row, an open diff's box, a copy's Apply —, each keyed by
   * what it is (the owner's of 11-01: drawn anew whole, they were new elements under a resting pointer, blinking, and a
   * press that began on one ended on another).
   */
  function paint() {
    if (gone) return;
    const keep = list.scrollTop;
    const empty = emptyOf({ folder: cwdOf() || null, reading: !v.answer && (loading || !error), error: v.answer ? (v.answer.ok ? null : v.answer.error) : error });
    if (empty) {
      morphChildren(summary, []);
      ctx.setBadge?.(0);
      morphChildren(list, [h("div", { class: "pane-empty chp-empty", "data-key": "empty" }, h("div", { class: "chp-empty-t" }, empty.title), ...kids([empty.line ? h("div", { class: "pane-note" }, empty.line) : null]))]);
      return;
    }
    const m = modelNow();
    ctx.setBadge?.(m.badge);
    morphChildren(summary, kids([h("span", { class: "chp-sum-t", "data-key": "sum" }, m.summary), m.waits ? h("span", { class: "agb-dot", "data-key": "waits", title: "Something waits for your Apply" }) : null, error ? h("span", { class: "chp-sum-err", "data-key": "err", title: error }, "· the last read failed") : null]));
    morphChildren(list, [
      ...m.mine.map(blockEl),
      ...(m.theirs.length ? [h("div", { class: "chp-section", "data-key": "theirs" }, `Other chats in ${m.repo}`), ...m.theirs.map(blockEl)] : []),
    ]);
    list.scrollTop = keep;
    reopen();
  }

  /** A place: its head, its facts, its agents, the files no agent wrote, a copy's Apply. @param {import("./changes-places.js").PlaceBlock} b */
  function blockEl(b) {
    const head = h("div", { class: "chp-head", "data-key": "head" },
      h("span", { class: "chg-ic", html: icon(b.kind === "folder" ? "folder" : "gitFork") }),
      h("span", { class: "chp-name", title: b.path }, b.name),
      h("span", { class: "chp-tag" }, b.tag),
      h("span", { class: "chp-gap" }),
      h("span", { class: "chp-branch", title: b.base ? `Its branch, against ${b.base}` : "Its branch" },
        h("span", { class: "chp-br-ic", html: icon("gitBranch") }), b.branch,
        b.ahead ? h("span", { class: "chp-ab", title: `${b.ahead} commit${b.ahead === 1 ? "" : "s"} not in ${b.base || "its base"} yet` }, `↑${b.ahead}`) : null,
        b.behind ? h("span", { class: "chp-ab", title: `${b.behind} commit${b.behind === 1 ? "" : "s"} of ${b.base || "its base"} not here yet` }, `↓${b.behind}`) : null),
      b.path && !b.saved ? openButton(b.path, "Open in your editor", "chg-open") : null);
    /** @type {any[]} */
    const kids = [head, b.facts ? h("div", { class: "chp-facts", "data-key": "facts" }, b.facts) : null];
    if (b.error) kids.push(h("div", { class: "chg-error", "data-key": "error" }, gitWords(b.error)));
    for (const a of b.agents) kids.push(agentEl(b, a));
    if (b.others.length) kids.push(...othersEl(b));
    if (b.sub && band) kids.push(...band.workOf(b.sub));
    if (!b.agents.length && !b.others.length && !b.error)
      kids.push(h("div", { class: "chg-nothing", "data-key": "nothing" }, b.kind === "folder" ? "No agent has written here since the last commit." : "Nothing uncommitted here."),
        b.kind === "folder" ? h("div", { class: "pane-note chp-readers", "data-key": "readers" }, "Agents that only read are on the Agents tab.") : null);
    return h("section", { class: `chg-block chp-place is-${b.kind}`, "data-key": b.key }, ...kids);
  }

  /** Whether an agent's files show: as the developer left it, else yours open and the others' folded. @param {import("./changes-places.js").AgentLine} a */
  const unfolded = (a) => v.agents.get(a.key) ?? (a.mine && a.files.length > 0);

  /** An agent in a place: its two lines and its ⋯; unfolded, its files. @param {import("./changes-places.js").PlaceBlock} b @param {import("./changes-places.js").AgentLine} a */
  function agentEl(b, a) {
    const open = unfolded(a);
    const vendor = a.model ? vendorOf(a.model) : null;
    const tile = vendor
      ? h("span", { class: "mp-tile chg-tile", style: `--tile:${vendor.hue}`, "aria-hidden": "true" }, vendor.mark)
      : h("span", { class: "agb-ic", html: icon("messageSquare") });
    const toggle = () => {
      v.agents.set(a.key, !open);
      paint();
    };
    const lines = a.files.length ? `${a.files.length} file${a.files.length === 1 ? "" : "s"}${linesWords(a.added, a.removed) ? ` ${linesWords(a.added, a.removed)}` : ""}` : "";
    // Its handlers through `h`: a draw in place carries them to the line that stands, so a press acts on what it shows now.
    const line = h("div", {
      class: `agb-row chp-agent t-${a.tone}${open ? " open" : ""}`, role: "button", tabindex: "0", "aria-expanded": String(open), "data-key": a.key, ...(a.sub ? { "data-sub": String(a.sub.id) } : {}),
      onclick: toggle,
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      },
    },
      h("span", { class: "chg-chev", html: ICONS.chevronRight }),
      tile,
      h("div", { class: "agb-text" },
        h("div", { class: "agb-l1" },
          h("span", { class: "agb-name", title: a.name }, a.name),
          a.about ? h("span", { class: "agb-about", title: a.about }, a.about) : null,
          a.model ? h("span", { class: "agb-model" }, doors ? doors.modelName(a.model) : a.model) : null,
          a.at ? h("span", { class: "agb-age" }, ageOf(a.at, now())) : null),
        h("div", { class: "agb-l2" },
          h("span", { class: `agb-now t-${a.tone}` }, [a.state, lines].filter(Boolean).join(" · ")))),
      moreButton(b, a));
    if (!open || !a.files.length) return line;
    const all = v.all.has(a.key);
    const shown = all ? a.files : a.files.slice(0, FILES_SHOWN);
    return h("div", { class: "chp-item", "data-key": a.key }, line,
      h("div", { class: "chp-files" },
        ...shown.map((f) => fileRow(b, f, `${a.key}\n${f.path}`, a.sub)),
        a.files.length > shown.length
          ? h("button", { class: "chg-link chp-all", type: "button", onclick: () => { v.all.add(a.key); paint(); } }, `Show all ${a.files.length}`)
          : null));
  }

  /** Its ⋯: its thread or its chat, Stop while it runs, its copy's path. @param {import("./changes-places.js").PlaceBlock} b @param {import("./changes-places.js").AgentLine} a */
  function moreButton(b, a) {
    // The menu hangs from the button pressed — the one that stands, which a draw in place hands this draw's handler.
    const btn = h("button", {
      class: "ghost icon agb-more", type: "button", "aria-label": `More for ${a.name}`, html: ICONS.ellipsis,
      onclick: (/** @type {MouseEvent} */ e) => {
        e.stopPropagation();
        const s = a.sub;
        menu([
          ...(s ? [{ label: "Open its thread", icon: "messageSquare", onClick: () => ctx.openSubagent(String(s.id)) }] : []),
          ...(!s && a.chain !== chainOf() && doors ? [{ label: "Open its chat", icon: "messageSquare", onClick: () => doors.openChat(a.chain) }] : []),
          ...(s && s.status === "running" && doors ? [{ label: "Stop it", icon: "circleSlash", onClick: () => doors.stopSubagent(String(s.id)) }] : []),
          ...(b.kind === "copy" && !b.saved ? [{ label: "Copy its copy's path", icon: "copy", onClick: () => { void navigator.clipboard?.writeText(b.path); } }] : []),
        ], { anchor: /** @type {HTMLElement} */ (e.currentTarget), side: "bottom", align: "end", width: 220 });
      },
    });
    tooltip(btn, { title: "More" });
    return btn;
  }

  /** The files no agent's edit wrote: a fold, open where it is the place's only group. @param {import("./changes-places.js").PlaceBlock} b */
  function othersEl(b) {
    const only = !b.agents.length;
    const open = only || v.others.has(b.key);
    const fold = h("button", { class: `chg-fold chp-others${open ? " open" : ""}`, type: "button", "aria-expanded": String(open), "data-key": "others", onclick: () => { if (v.others.has(b.key)) v.others.delete(b.key); else v.others.add(b.key); paint(); } },
      h("span", { class: "chg-chev", html: ICONS.chevronRight }),
      `Other changes · ${b.others.length} file${b.others.length === 1 ? "" : "s"}`, h("span", { class: "chg-q" }, " — not from an agent's edit"));
    const files = () => h("div", { class: "chp-files", "data-key": "others-files" }, ...b.others.map((f) => fileRow(b, f, `${b.key}\nother\n${f.path}`, null)));
    if (only) return [h("div", { class: "chp-others-head", "data-key": "others" }, `Other changes · ${b.others.length} file${b.others.length === 1 ? "" : "s"}`, h("span", { class: "chg-q" }, " — not from an agent's edit")), files()];
    return [fold, ...(open ? [files()] : [])];
  }

  /**
   * A file's row; its click opens its diff under it, and closes it. A copy's waiting file reads the sub-agent's change;
   * any other, the place's against its last commit.
   * @param {import("./changes-places.js").PlaceBlock} b @param {import("./changes-places.js").PlaceFile} f @param {string} key
   * @param {import("../lib/subagents.js").SubagentRow | null} sub
   */
  function fileRow(b, f, key, sub) {
    const { letter, cls } = letterOf(f.status);
    const { dir, leaf } = dirLeaf(f.path);
    const open = v.open === key;
    const row = h("button", { class: `chg-file${open ? " open" : ""}`, type: "button", title: f.path, "aria-expanded": String(open), "data-path": f.path, "data-key": key, onclick: () => { v.open = open ? null : key; paint(); } },
      h("span", { class: "chg-chev", html: ICONS.chevronRight }),
      h("span", { class: `git-letter ${cls}` }, letter),
      h("span", { class: "chg-path" }, dir ? h("span", { class: "chg-dir" }, dir) : null, leaf, f.oldPath ? h("span", { class: "chg-dir" }, ` ← ${f.oldPath}`) : null),
      f.also.length ? h("span", { class: "chg-mark", title: `${f.also.join(", ")} also wrote it since its last commit` }, `also ${f.also[0]}${f.also.length > 1 ? ` +${f.also.length - 1}` : ""}`) : null,
      f.binary ? h("span", { class: "chg-fig" }, "binary") : f.untracked ? h("span", { class: "chg-fig" }, "new") : diffCount({ added: f.added || 0, removed: f.removed || 0 }).el);
    const holder = h("div", { class: "chg-row", "data-key": key }, row);
    if (open) holder.append(diffBox(b, f, key, sub));
    return holder;
  }

  /**
   * A file's diff: read once a read of its place, drawn rich. Its counts alone say too little — a line edited again, a
   * new file, keep theirs — so each new read reads it again, the last one shown meanwhile. Its box is this draw's, drawn
   * over the one that stands with what it holds kept (`data-placed`), and a read fills the one on the page (`standing`)
   * where it answers something else than the box holds: read again the same, the diff and its header stand.
   * @param {import("./changes-places.js").PlaceBlock} b @param {import("./changes-places.js").PlaceFile} f @param {string} key @param {import("../lib/subagents.js").SubagentRow | null} sub
   */
  function diffBox(b, f, key, sub) {
    const box = h("div", { class: "chg-diff", "data-key": "diff", "data-placed": "" }, h("div", { class: "pane-note" }, "Reading the diff…"));
    const sig = `${f.status}:${f.added}:${f.removed}:${sub?.work?.sig || ""}:${v.at}`;
    const hit = diffs.get(key);
    const fill = (/** @type {any} */ d) => {
      const at = /** @type {HTMLElement} */ (standing(box));
      if (!at.isConnected && v.open !== key) return;
      const text = JSON.stringify(d ?? null);
      if (holds.get(at) === text) return;
      holds.set(at, text);
      const binary = f.binary || d?.binary;
      const words = !d ? "its diff is no longer there" : d.error ? gitWords(d.error) : binary ? binaryWords({ size: d.size }) : !d.patch ? "no change in its content" : cutWords(d);
      const abs = b.path && !b.saved ? absOf(b.path, f.path) : null;
      at.replaceChildren(
        h("div", { class: "chg-dh" },
          h("span", { class: "chg-dh-path" }, f.path),
          words ? h("span", { class: "chg-dh-note" }, words) : null,
          h("span", { class: "chg-end" }, abs ? openButton(abs, b.kind === "copy" ? "Open its version" : "Open the file", "chg-open") : null)),
        ...(d?.patch && !binary ? [diffView(d.patch)] : []));
      if (d?.patch && !binary) painter(at, d.patch, f.path);
    };
    // Painted once its box is on the page: the rich diff weighs the room it has.
    if (hit) void Promise.resolve().then(() => fill(hit.data));
    if (hit?.sig === sig) return box;
    readDiff(b, f, sub).then(
      (d) => {
        diffs.set(key, { sig, data: d });
        if (v.open === key) fill(d);
      },
      (e) => fill({ error: String(e?.message || e) }),
    );
    return box;
  }

  /** @param {import("./changes-places.js").PlaceBlock} b @param {import("./changes-places.js").PlaceFile} f @param {import("../lib/subagents.js").SubagentRow | null} sub @returns {Promise<any>} */
  async function readDiff(b, f, sub) {
    if (sub?.work?.pending && doors) {
      const sig = `${sub.work.sig || ""}:${sub.work.pending}`;
      let had = copyDiffs.get(String(sub.id));
      if (!had || had.sig !== sig) {
        had = { sig, p: doors.diffOf(String(sub.id)).then((r) => splitPatch(String(r?.diff || ""))) };
        copyDiffs.set(String(sub.id), had);
      }
      const parts = await had.p;
      return { patch: parts.get(f.path) || "" };
    }
    return api(`/git/branch?cwd=${enc(cwdOf())}&place=${enc(b.path)}&part=uncommitted&path=${enc(f.path)}${f.oldPath ? `&old=${enc(f.oldPath)}` : ""}`);
  }

  /** The file a caller asked for, opened and in view once its row is drawn. */
  function reopen() {
    const ask = v.ask;
    if (!ask) return;
    const rows = /** @type {HTMLElement[]} */ ([...list.querySelectorAll(".chg-file")]);
    const row = rows.find((r) => r.getAttribute("data-path") === ask.path);
    if (!row) {
      // Committed since, or never here: let go once a read of this pane has answered without it.
      if (landed && !loading) v.ask = null;
      return;
    }
    v.ask = null;
    v.open = row.getAttribute("data-key");
    paint();
    /** @type {HTMLElement | null} */ (list.querySelector(".chg-file.open"))?.scrollIntoView?.({ block: "nearest" });
  }

  /** A sub-agent's line open and in view; false where none is drawn. @param {string} key `sub:<id>` */
  function reveal(key) {
    const id = key.startsWith("sub:") ? key.slice(4) : key;
    const m = v.answer ? modelNow() : null;
    const a = m ? [...m.mine, ...m.theirs].flatMap((b) => b.agents).find((x) => x.sub && String(x.sub.id) === id) : null;
    if (!a) return false;
    v.agents.set(a.key, true);
    paint();
    const line = /** @type {HTMLElement | null} */ ([...list.querySelectorAll(".chp-agent")].find((x) => x.getAttribute("data-sub") === id) || null);
    line?.scrollIntoView?.({ block: "nearest" });
    line?.focus?.();
    return true;
  }

  /**
   * The host's pulse, the sub-agents' moves and the pane's own look (`lookLater`): reads again at a turn's end, as the
   * sub-agents move, and once the last answer is old; else draws again only what its words would change (an age, a state).
   * Out of sight, it waits for the page to show again, and pulses once then (lib/page-shown.js): a turn's end or a move
   * it missed reads as it would have — a page kept hidden read the places at each round of a running sub-agent.
   */
  function pulse() {
    if (!pageShown()) return void whenPageShown(pulseShown, () => { if (!gone && root.isConnected) pulse(); });
    const live = !!chat?.live;
    const subs = subsSig(ctx.subagents());
    const applies = appliesSig(ctx.subagents());
    const ended = wasLive && !live;
    if (ended || subs !== subsSeen || (v.at && now() - v.at > READ_EVERY_MS && !loading)) {
      const applied = applies !== appliesSeen;
      wasLive = live;
      subsSeen = subs;
      appliesSeen = applies;
      // A turn's end and an Apply read past the server's cache: each wrote just now.
      void load(ended || applied);
      return;
    }
    wasLive = live;
    const key = `${live}:${subs}:${Math.floor(now() / 60_000)}`;
    if (key !== drawKey) {
      drawKey = key;
      paint();
    }
    const ask = askedNow();
    if (ask && reveal(ask)) askedAgent = null;
  }

  function letGo() {
    gone = true;
    band?.stop();
    clearTimeout(every);
    every = null;
  }

  ready = true;
  paint();
  // The last answer first, then a read: the places move while the tab is away.
  void load(false).then(() => {
    const ask = askedNow();
    if (!gone && ask && reveal(ask)) askedAgent = null;
  });
  return { chat, root, pulse, paint, reveal, reread: () => void load(true), letGo };
}
