// @ts-check
// Works in, at the start (HarnessV4_Git_Plan step 5; proposal_ux §4.13): the Start's second question — where the chat
// changes files — as three choices: This folder, Another worktree (the repository's other places, in its menu, GW-D43)
// and A new worktree, whose branch name sits beside them, made from the message until you type one (GW-D44). Under the
// row, for a new worktree: what it gets a copy of (worktree-copy.js, HarnessV4_Four_Plan FO-D34) and what the send will
// do (GW-D45). The start's sentence reads the folder's path and branch from here. The choice is held on the chat
// (`chat.worksIn`) until its first send: a place's folder is the chat's folder (GW-D49); a new worktree rides the
// create as `worktree` and is made there. Another folder drops it (GWC-101).
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { menu } from "../lib/ui.js";
import { branchWords, pathLike } from "../lib/labels.js";
import { gitMovedFor } from "../lib/git-moved.js";
import { createCopyLine } from "../worktree-copy.js";

/** A path as the project id compares it: forward slashes, no trailing one, lower case. @param {unknown} p */
const normalizeCwd = (p) => String(p ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Words a name made from the message leaves out: they say nothing of the task. */
const FILLER = new Set(
  ("a an the to of in on at by for from with into onto about as and or but so then than now also just please can could " +
    "would should will shall may might must do does did done make made let lets i me my we us our you your it its this " +
    "that these those there here is are was were be been being have has had some any all after before when where what " +
    "which who how why if not no yes ok okay hi hey").split(" "),
);
/** What the row says with no folder chosen: where the chat works, and what a project would offer. */
export const OUTSIDE_WORDS = "Everything, a folder of Filament's own. Pick a project to work in its repository or a new worktree.";

/** How many words a made name keeps, and its longest. */
const NAME_WORDS = 3;
const NAME_LONGEST = 40;

/**
 * A new worktree's name made from the message (GW-D44, GWC-115): its first words that are not filler, lower case,
 * joined by "-", "task" when none is left. "Fix the login redirect: …" → "fix-login-redirect".
 * @param {string} text
 */
export function nameFromMessage(text) {
  const words = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLER.has(w));
  let name = words.slice(0, NAME_WORDS).join("-");
  if (name.length > NAME_LONGEST) name = name.slice(0, NAME_LONGEST).replace(/-[^-]*$/, "") || name.slice(0, NAME_LONGEST);
  return name || "task";
}

/**
 * The choice A new worktree holds, its name made from the message: what its button chooses, and what the Space's New
 * lane… puts on a chat before its Start draws (proposal_ux §4.14).
 * @param {string} folder @param {string} [text]  the message so far
 */
export function newWorktreeChoice(folder, text = "") {
  const name = nameFromMessage(text);
  return { make: true, name, fromMessage: name, typed: false, folder };
}

/**
 * The choice A new worktree holds, its name given (Reproduce…'s `repro/play-91`, HarnessV4_Space_Plan S7-D2): kept as
 * the message moves — it is no name made from the message —, and, being Filament's own, it gives way to the first free
 * one where it is taken, as a name made from the message does (GW-D44).
 * @param {string} folder @param {string} name
 */
export function givenWorktreeChoice(folder, name) {
  return { make: true, name, fromMessage: name, given: name, typed: false, folder };
}

/**
 * A name as typed in the field: spaces become "-"; the rest is the server's to judge (GWC-106).
 * @param {string} typed
 */
export const typedName = (typed) => String(typed || "").trim().replace(/\s+/g, "-");

/**
 * The place a folder is in, among a repository's places: the deepest whose folder holds it. Null where none does.
 * @template {{ path: string }} P
 * @param {P[]} places @param {string} folder
 * @returns {P | null}
 */
export function placeHolding(places, folder) {
  const f = normalizeCwd(folder);
  let best = null;
  for (const p of places || []) {
    const k = normalizeCwd(p.path);
    if (k && (f === k || f.startsWith(`${k}/`)) && (!best || k.length > normalizeCwd(best.path).length)) best = p;
  }
  return best;
}

/**
 * The folder at the same place in `to` as `folder` is in `from` (GWC-117): `H:\app\src` from `H:\app` into
 * `H:/app-wt` is `H:/app-wt/src`.
 * @param {string} folder @param {string} from @param {string} to
 */
export function samePlaceIn(folder, from, to) {
  const rest = String(folder).replace(/\\/g, "/").replace(/\/+$/, "").slice(String(from).replace(/\\/g, "/").replace(/\/+$/, "").length);
  return `${String(to).replace(/[\\/]+$/, "")}${rest}`;
}

/** The longest a chat's name runs in a menu row's note: past it the name is cut, the sidebar has it whole. */
const NOTE_NAME = 40;

/**
 * Who works in a place, as its menu row says it: "this folder" for the chooser's own, else its chats, else what it is.
 * @param {{ main?: boolean, chats?: { name?: string }[] }} p @param {boolean} here
 */
export function placeNote(p, here) {
  if (here) return "this folder";
  const chats = p.chats || [];
  if (!chats.length) return p.main ? "the main folder" : "a worktree";
  if (chats.length > 1) return `${chats.length} chats work here`;
  const name = chats[0].name || "an untitled chat";
  return `“${name.length > NOTE_NAME ? `${name.slice(0, NOTE_NAME - 1).trimEnd()}…` : name}” works here`;
}

/**
 * Why a place cannot be worked in from the start (GWC-116), in words; null where it can.
 * @param {{ ok?: boolean, missing?: boolean, error?: string | null }} p
 */
export const placeBlocked = (p) => (p.missing ? "its folder is gone" : p.ok === false ? p.error || "git could not read it" : null);

/**
 * What the row says: which of its three is chosen, the second's label — the place chosen, with its branch — and the
 * quiet note beside them: the chosen place's folder, or the chats that already work in this one.
 * @param {any} choice  `chat.worksIn` @param {{ chats?: { name?: string }[], main?: boolean } | null} own  the chooser
 *   folder's place @param {string} folder  the chooser's folder, as typed
 * @returns {{ on: "here" | "other" | "new", other: string, note: string }}
 */
export function worksInWords(choice, own, folder) {
  if (choice?.make) return { on: "new", other: "Another worktree", note: "" };
  if (choice?.path) return { on: "other", other: `${choice.name} · ${choice.branch}`, note: pathLike(choice.cwd, folder) };
  return { on: "here", other: "Another worktree", note: (own?.chats || []).length ? placeNote(own || {}, false) : "" };
}

/**
 * The start's sentence after the project: its folder and the branch it is on ("H:\app · main").
 * @param {string} folder @param {{ branch?: string | null, head?: string | null } | null} own
 */
export const whereWords = (folder, own) => [folder, own ? branchWords(own) : ""].filter(Boolean).join(" · ");

/**
 * What the send will do, in words (GW-D45), from the server's plan of the name (`GET /git/places/new`): the sentence,
 * and the mark beside it — the name free, or why not, with a free one to use where it is taken by a name you typed.
 * @param {any} plan @param {string} like  a path spelled as the developer's folder is
 * @returns {{ say: string, mark: { ok: boolean, text: string }, use: string | null }}
 */
export function makeWords(plan, like = "") {
  if (!plan?.ok) return { say: "", mark: { ok: false, text: plan?.error || "git could not tell" }, use: null };
  const from = plan.from?.branch ? `${plan.from.branch}'s last commit (${plan.from.head})` : `commit ${plan.from?.head}`;
  const n = Number(plan.uncommitted) || 0;
  // What git ignores is the copy line's to say (HarnessV4_Four_Plan FO-D34): copied there, or said not copied.
  const stays = n ? ` Your ${n} uncommitted file${n === 1 ? "" : "s"} stay${n === 1 ? "s" : ""} in ${plan.here}.` : "";
  const say = plan.folder ? `Makes the branch ${plan.branch} from ${from} and the folder ${pathLike(plan.folder, like)} when you send.${stays}` : "";
  if (plan.bad) return { say, mark: { ok: false, text: plan.bad }, use: null };
  if (plan.taken) {
    const what = plan.taken === "folder" ? `the folder ${pathLike(String(plan.folder), like)}` : `the branch ${plan.name}`;
    return { say, mark: { ok: false, text: `${what} is there already` }, use: plan.free || null };
  }
  if (plan.refused) return { say, mark: { ok: false, text: plan.refused }, use: null };
  // A folder git does not track is not in the commit the worktree starts at (GW-D50).
  if (plan.lacks) return { say, mark: { ok: false, text: `${plan.lacks} is not in git, so the new worktree would not have it` }, use: null };
  return { say, mark: { ok: true, text: "the name is free" }, use: null };
}

/**
 * The row's control, the line under it and the sentence's folder. `chat`: the unborn chat the choice is held on;
 * `folder`: the chooser's; `text`: the message as typed; `changed`: the choice moved, for the Start board to weigh it
 * again (GWC-118).
 * @param {{ chat: () => any, folder: () => string, text: () => string, changed: () => void }} cb
 * @returns {{ control: HTMLElement, line: HTMLElement, where: HTMLElement, refresh: () => void, moved: (msg: any) => boolean, draftChanged: () => void }}
 */
export function createWorksIn(cb) {
  const glyph = (/** @type {Parameters<typeof icon>[0]} */ name) => h("span", { class: "works-in-ic", html: icon(name) });
  const hereBtn = h("button", { class: "inst-seg-btn works-in-here", type: "button", title: "It changes files in the folder you chose", onclick: () => choose(null) }, glyph("folder"), "This folder");
  const otherText = h("span", { class: "works-in-other-text" });
  const otherBtn = h("button", { class: "inst-seg-btn works-in-other", type: "button", "aria-haspopup": "menu", onclick: (/** @type {Event} */ e) => { e.stopPropagation(); othersMenu(); } },
    glyph("gitFork"), otherText, h("span", { class: "works-in-chev", html: icon("chevronDown") }));
  const newBtn = h("button", { class: "inst-seg-btn works-in-new", type: "button", title: "A branch and a folder of its own, made when you send", onclick: () => makeNew() }, glyph("gitBranch"), "A new worktree");
  const seg = h("div", { class: "inst-seg works-in-seg hidden", role: "group", "aria-label": "Where it works" }, hereBtn, otherBtn, newBtn);
  const nameIn = /** @type {HTMLInputElement} */ (h("input", { class: "works-in-name", type: "text", spellcheck: "false", maxlength: "60", "aria-label": "The new worktree's branch" }));
  const nameWrap = h("label", { class: "works-in-namechip hidden", title: "The new worktree's branch: made from your message until you type one" }, glyph("gitBranch"), nameIn);
  const note = h("span", { class: "works-in-note" });
  const control = h("div", { class: "works-in-ctl" }, seg, nameWrap, note);
  const say = h("p", { class: "works-in-say" });
  const mark = h("span", { class: "works-in-mark" });
  // What the new worktree gets a copy of (HarnessV4_Four_Plan FO-D34): the paths left on ride the choice as `copy`.
  const copy = createCopyLine({
    folder: () => cb.folder(),
    off: () => unborn()?.worksIn?.off || [],
    setOff: (off) => {
      const c = unborn();
      if (c?.worksIn?.make) c.worksIn.off = off;
    },
    changed: () => {
      const c = unborn();
      if (!c?.worksIn?.make) return;
      const paths = copy.paths();
      if (paths) c.worksIn.copy = paths;
      else delete c.worksIn.copy;
    },
  });
  const line = h("div", { class: "works-in-line hidden" }, copy.el, h("div", { class: "works-in-said" }, say, mark));
  const where = h("span", { class: "works-in-where" });

  /** The places of the chooser folder's repository as last read, and that folder. */
  /** @type {{ folder: string, answer: any } | null} */
  let read = null;
  /** The folder whose places are being read, while git answers: "" for none. */
  let reading = "";
  let seq = 0;
  let checkSeq = 0;
  let checkTimer = 0;

  const unborn = () => {
    const c = cb.chat();
    return c && !c.chainId ? c : null;
  };
  /** The chooser folder's own place in the last read. */
  const here = () => (read?.answer?.ok ? placeHolding(/** @type {any[]} */ (read.answer.places || []), read.folder) : null);
  /** The repository's places but the chooser folder's own. */
  const others = () => {
    const own = here();
    return read?.answer?.ok ? /** @type {any[]} */ (read.answer.places || []).filter((p) => p !== own) : [];
  };

  function paint() {
    const c = unborn();
    const current = !!(c && read && read.folder === cb.folder());
    const repo = current && !!read?.answer?.ok;
    seg.classList.toggle("hidden", !repo);
    const choice = repo ? c.worksIn : null;
    const w = worksInWords(choice, here(), cb.folder());
    for (const [b, on] of /** @type {[HTMLElement, boolean][]} */ ([[hereBtn, w.on === "here"], [otherBtn, w.on === "other"], [newBtn, w.on === "new"]])) {
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    otherText.textContent = w.other;
    otherBtn.classList.toggle("hidden", !others().length);
    otherBtn.setAttribute("title", choice?.path ? pathLike(choice.cwd, cb.folder()) : "Work in another of this repository's folders");
    // While git answers, the row says it reads (the owner's of 11-01: on a busy server Works in stood empty, saying
    // nothing, until the places came).
    const waits = !current && !!c && !!reading && reading === cb.folder();
    // No folder chosen: the chat works in Everything (app.js readySession), and a repository's places wait for a project.
    note.textContent = !cb.folder() && c ? OUTSIDE_WORDS : waits ? "Reading the repository…" : !current ? "" : !repo ? "Not a git repository: it works in the folder itself." : w.note;
    where.textContent = current ? whereWords(cb.folder(), here()) : cb.folder();
    nameWrap.classList.toggle("hidden", !choice?.make);
    line.classList.toggle("hidden", !choice?.make);
    // A name Filament made is shown even in the focused field (it gave way to a free one): the field never names
    // another branch than the send makes. A name being typed is left alone, and so is a field emptied to type one,
    // whose placeholder names the made one in force.
    if (choice?.make) {
      nameIn.placeholder = choice.typed ? "" : choice.name || "";
      const emptied = document.activeElement === nameIn && !nameIn.value;
      if (!emptied && (!choice.typed || document.activeElement !== nameIn)) nameIn.value = choice.name || "";
    }
  }

  /** Read the places for the chooser's folder; a choice made for another folder is dropped (GWC-101). */
  async function load() {
    const folder = cb.folder();
    const c = unborn();
    if (c?.worksIn && c.worksIn.folder !== folder) {
      delete c.worksIn;
      cb.changed();
    }
    if (!folder || !c) {
      read = null;
      return paint();
    }
    const mine = ++seq;
    reading = folder;
    paint();
    let answer = null;
    try {
      answer = await api(`/git/places?cwd=${encodeURIComponent(folder)}`);
    } catch {
      answer = null;
    }
    if (mine !== seq) return;
    reading = "";
    read = { folder, answer };
    // A worktree chosen before the Start drew — the Space's New lane…, Pick up…, Reproduce… — where git reads no
    // repository: the row hides its choices and says the chat works in the folder itself, so the choice goes, and the
    // send does what the row says (d-word, 11-12: the hidden choice rode the create, refused 409 with no chat made).
    if (c.worksIn && !answer?.ok && unborn() === c) {
      delete c.worksIn;
      cb.changed();
    }
    paint();
    if (c.worksIn?.make) {
      check(0);
      copy.refresh();
    }
  }

  /** Ask the server about the new worktree's name, after `delay` ms (GW-D44). @param {number} delay */
  function check(delay) {
    clearTimeout(checkTimer);
    checkTimer = Number(setTimeout(async () => {
      const c = unborn();
      if (!c?.worksIn?.make) return;
      const mine = ++checkSeq;
      const folder = cb.folder();
      let plan;
      try {
        plan = await api(`/git/places/new?cwd=${encodeURIComponent(folder)}&name=${encodeURIComponent(c.worksIn.name)}`);
      } catch (/** @type {any} */ e) {
        plan = { ok: false, error: String(e?.message || e) };
      }
      if (mine !== checkSeq || unborn() !== c || !c.worksIn?.make) return;
      // A name Filament made gives way to the first free one without a word (GW-D44).
      if (plan.ok && plan.taken && plan.free && !c.worksIn.typed) {
        c.worksIn.name = plan.free;
        paint();
        return check(0);
      }
      const w = makeWords(plan, folder);
      say.textContent = w.say;
      mark.replaceChildren(h("span", { class: "works-in-mark-ic", html: icon(w.mark.ok ? "check" : "info") }), w.mark.text);
      const use = w.use;
      if (use) mark.append(h("button", { class: "ghost sm works-in-use", type: "button", onclick: () => setName(use, true) }, `Use ${use}`));
      mark.classList.toggle("is-bad", !w.mark.ok);
    }, delay));
  }

  /**
   * A name typed, or made from the message: that one is kept as `fromMessage`, apart from the free name it may give
   * way to, so the message moving asks again only when it makes another name.
   * @param {string} name @param {boolean} typed
   */
  function setName(name, typed) {
    const c = unborn();
    if (!c?.worksIn?.make) return;
    c.worksIn.name = name;
    c.worksIn.typed = typed;
    if (!typed) {
      c.worksIn.fromMessage = name;
      nameIn.placeholder = name;
    }
    if (document.activeElement !== nameIn) nameIn.value = name;
    check(typed ? 300 : 150);
  }

  /**
   * The name the message makes; while it holds nothing, the one it made last. The send empties the message before
   * the chat is made, and an emptied message says nothing of the task.
   * @param {any} c
   */
  const madeName = (c) => (c?.worksIn?.given ? c.worksIn.given : String(cb.text() || "").trim() ? nameFromMessage(cb.text()) : c?.worksIn?.fromMessage || nameFromMessage(""));

  nameIn.addEventListener("input", () => {
    const typed = typedName(nameIn.value);
    if (typed) setName(typed, true);
    else setName(madeName(unborn()), false);
  });

  /** @param {any} choice */
  function choose(choice) {
    const c = unborn();
    if (!c) return;
    if (choice) c.worksIn = { ...choice, folder: cb.folder() };
    else delete c.worksIn;
    say.textContent = "";
    mark.replaceChildren();
    paint();
    cb.changed();
    if (c.worksIn?.make) {
      check(0);
      copy.refresh();
      nameIn.focus();
      nameIn.select();
    }
  }

  /** A new worktree, named from the message; pressed again while chosen, it stays as it is. */
  function makeNew() {
    const c = unborn();
    if (!c || c.worksIn?.make) return;
    choose(newWorktreeChoice(cb.folder(), cb.text()));
  }

  /** Another worktree: the repository's other places, each with who works there or why it cannot be chosen. */
  function othersMenu() {
    const c = unborn();
    const own = here();
    if (!c || !read?.answer?.ok) return;
    menu(others().map((p) => {
      const blocked = placeBlocked(p);
      return {
        type: "check",
        icon: p.main ? "folder" : "gitFork",
        label: `${p.name} · ${branchWords(p) || "no branch"}`,
        desc: blocked || placeNote(p, false),
        disabled: !!blocked,
        checked: !!c.worksIn?.path && normalizeCwd(c.worksIn.path) === normalizeCwd(p.path),
        onClick: () => choose({ path: p.path, cwd: samePlaceIn(read?.folder || "", own?.path || "", p.path), name: p.name, branch: branchWords(p) }),
      };
    }), { anchor: otherBtn, side: "bottom", align: "start", width: 320 });
  }

  return {
    control,
    line,
    where,
    refresh: () => void load(),
    // Whether the feed's `git-moved` (lib/git-moved.js) says the places last read moved: read them again, at once.
    moved: (/** @type {any} */ msg) => !!read && gitMovedFor(msg, "places", [read.folder, read.answer?.cwd, read.answer?.main]),
    // The message moved: a name Filament made follows it (GW-D44, GWC-102), never to an emptied one. A name the Space
    // gave (Reproduce…'s `repro/play-91`, S7-D2) stays as it is.
    draftChanged: () => {
      const c = unborn();
      if (!c?.worksIn?.make || c.worksIn.typed || c.worksIn.given) return;
      const name = madeName(c);
      if (name !== c.worksIn.fromMessage) setName(name, false);
    },
  };
}
