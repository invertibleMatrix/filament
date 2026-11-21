// @ts-check
// Move a chat to a worktree (HarnessV4_Git_Plan §12, GW-D74): the sheet that says where the chat would go and what
// would go with it — each file that goes with its counts, each that stays with why, everyone else's files that stay,
// what git ignores, what still runs in the old folder — read again as the name or the place changes, and Move. A new
// worktree gets the project's template copied in, said on its line (worktree-copy.js, HarnessV4_Four_Plan FOC-67).
// The server checks it all again at the click, against the files this sheet showed (GW-D84).
import { h } from "../lib/dom.js";
import { api } from "./lib/api.js";
import { icon } from "./lib/icons.js";
import { dialog, diffCount } from "./lib/ui.js";
import { pathLike, placeName } from "./lib/labels.js";
import { statusLetter } from "./panes/pane-data.js";
import { dirLeaf } from "./panes/changes-data.js";
import { nameFromMessage, placeHolding, typedName } from "./conversation/works-in.js";
import { createCopyLine } from "./worktree-copy.js";
import { gitMovedFor } from "./lib/git-moved.js";

/** The value of the place list's first choice: a new worktree. */
const NEW = "";
/** How long the name rests before it is read again. */
const READ_AFTER_MS = 300;

/** One place, however its slashes and case are spelled. @param {string} p */
const placeKey = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
/** @param {number} n @param {string} one @param {string} [many] */
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What the sheet says of a read (`GET /sessions/:id/move`), in words: where to, the files that stay grouped by why,
 * the committed ones counted, everyone else's, what git ignores, what still runs. Pure, for the tests.
 * @param {any} plan @param {string} [like]  a path spelled as the chat's folder is
 * @param {readonly string[]} [copying]  what the new worktree gets a copy of (HarnessV4_Four_Plan FOC-67)
 */
export function moveWords(plan, like = "", copying = []) {
  const to = plan.to || {};
  const from = plan.from?.name || "its folder";
  const where = to.new
    ? to.folder
      ? `A new worktree ${pathLike(to.folder, like)} on a new branch ${to.branch || to.name}, made from ${plan.from?.branch ? `${plan.from.branch}'s` : "its"} commit.`
      : ""
    : `${to.name}${to.branch ? `, on ${to.branch}` : ""}: its files land there as uncommitted changes.`;
  const stays = (plan.stays || []).filter((/** @type {any} */ f) => f.why !== "committed");
  const committed = (plan.stays || []).length - stays.length;
  const ignored = plan.ignored?.names?.length ? `${plan.ignored.names.join(", ")}${plan.ignored.more ? `, and ${plan.ignored.more} more` : ""}` : "";
  return {
    where,
    goes: (plan.goes || []).length ? `Goes · ${count(plan.goes.length, "file")}` : `Nothing uncommitted of its own in ${from}: the chat moves alone.`,
    stays: stays.length ? `Stays in ${from} · ${count(stays.length, "file")}` : "",
    committed: committed ? `${count(committed, "of its files is", "of its files are")} committed: nothing to carry.` : "",
    others: plan.others ? `${count(plan.others, "other uncommitted file")} in ${from} ${plan.others === 1 ? "stays" : "stay"} where ${plan.others === 1 ? "it is" : "they are"}.` : "",
    ignored: ignored ? `Not carried: what git ignores — ${ignored}${to.new && copying.length ? ", but for what the line above copies" : ""}. The agent is told.` : "",
    running: (plan.running || []).map((/** @type {any} */ s) => `Still running in ${from}, left running: ${s.command}`),
    blocked: (plan.blocked || [])[0] || "",
  };
}

/**
 * The sheet. `onMoving`: the move as Move posts it, on its way — the page knows the move it asked for before the events
 * feed says the move's end; `onMoved`: the move's answer, once the chat has moved; `hear`: the events feed while the
 * sheet is open (lib/bus.js `onBus`), where it hears that the repository's places moved (`git-moved`).
 * @param {{ chat: any, title: string, onMoving?: (move: Promise<any>) => void, onMoved: (done: any) => void, onToast: (msg: string, kind?: string) => void,
 *   hear?: (fn: (msg: any) => void) => () => void }} o
 */
export function moveSheet({ chat, title, onMoving, onMoved, onToast, hear }) {
  const id = encodeURIComponent(String(chat.chainId));
  const like = String(chat.cwd || "");
  const placeIn = h("select", { class: "zc-input mv-place", "aria-label": "Where to" }, h("option", { value: NEW }, "New worktree"));
  const nameIn = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input mv-name", type: "text", spellcheck: "false", autocomplete: "off", "aria-label": "Its name" }));
  nameIn.value = nameFromMessage(title);
  const whereLine = h("div", { class: "mv-where" });
  const list = h("div", { class: "mv-list" });
  const said = h("div", { class: "mv-said", role: "status" });
  /** The paths of the project's worktree template left off for this worktree (HarnessV4_Four_Plan FO-D34). */
  /** @type {string[]} */
  let off = [];
  const copy = createCopyLine({ folder: () => like, off: () => off, setOff: (o) => void (off = o), changed: () => void (plan && draw()) });
  /** The name is the page's own until the person types one: a taken one then gives way to a free one (GW-D44). */
  let madeName = true;
  /** @type {any} */
  let plan = null;
  let reads = 0;
  let moving = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let rest = null;
  const to = () => {
    if (placeIn.value !== NEW) return { place: placeIn.value };
    const paths = copy.paths();
    return { name: typedName(nameIn.value), made: madeName, ...(paths ? { copy: paths } : {}) };
  };
  const query = () => {
    const t = to();
    return "place" in t ? `place=${encodeURIComponent(String(t.place))}` : `name=${encodeURIComponent(t.name)}${t.made ? "&made=1" : ""}`;
  };
  /** @type {any} */
  const d = dialog({
    title: "Move this chat to a worktree",
    glyph: h("span", { class: "chg-sheet-glyph", html: icon("gitFork") }),
    description: "The chat and its own uncommitted files go; everyone else's stay. Its next turn works there.",
    body: h("div", { class: "chg-sheet mv-sheet" }, h("div", { class: "mv-to" }, placeIn, nameIn), whereLine, copy.el, list, said),
    wide: true,
    actions: [
      { label: "Cancel", variant: "outline", onClick: () => d.close() },
      { label: "Move", onClick: () => void go() },
    ],
    onClose: () => offPlaces(),
  });
  const moveBtn = /** @type {HTMLButtonElement | undefined} */ ([...d.el.querySelectorAll(".zc-dialog-foot button")].at(-1));
  moveBtn?.insertBefore(h("span", { class: "mv-spin", "aria-hidden": "true", html: icon("loader") }), moveBtn.firstChild);
  const ready = (/** @type {boolean} */ ok) => {
    if (moveBtn) moveBtn.disabled = !ok || moving;
  };
  /**
   * A read or the move on its way — a long chat's read takes seconds to a minute (the owner's of 10-30): Move turns
   * its spinner, the line under the list says what it waits on, and the last read's words dim, no longer the answer
   * for where the chat would go. `words` null: nothing on its way.
   * @param {string | null} words
   */
  const waiting = (words) => {
    moveBtn?.setAttribute("aria-busy", words ? "true" : "false");
    whereLine.classList.toggle("is-stale", !!words);
    list.classList.toggle("is-stale", !!words);
    said.classList.toggle("is-waiting", !!words);
    if (words) {
      said.classList.remove("is-err");
      said.replaceChildren(h("span", { class: "mv-wait-spin", "aria-hidden": "true", html: icon("loader") }), h("span", {}, words));
    }
  };
  ready(false);

  /** A file's row: its letter, its path, then its counts or why it stays. @param {any} f @param {string | null} why */
  const fileRow = (f, why) => {
    const { letter, cls } = statusLetter(f);
    const { dir, leaf } = dirLeaf(f.path);
    return h("div", { class: "mv-file", title: f.path },
      h("span", { class: `git-letter ${cls}` }, letter),
      h("span", { class: "chg-path" }, dir ? h("span", { class: "chg-dir" }, dir) : null, leaf, f.oldPath ? h("span", { class: "chg-dir" }, ` ← ${f.oldPath}`) : null),
      why ? h("span", { class: "mv-why" }, why) : f.binary ? h("span", { class: "chg-fig" }, "binary") : diffCount({ added: f.added, removed: f.removed }).el);
  };

  function draw() {
    waiting(null);
    const w = moveWords(plan, like, placeIn.value === NEW ? copy.paths() || [] : []);
    whereLine.textContent = w.where;
    nameIn.hidden = placeIn.value !== NEW;
    copy.el.hidden = placeIn.value !== NEW;
    // A name the page made gives way to a free one where it is taken: the field says the one the move takes.
    if (madeName && plan.to?.new && plan.to.name && !plan.to.bad) nameIn.value = plan.to.name;
    const stays = (plan.stays || []).filter((/** @type {any} */ f) => f.why !== "committed");
    list.replaceChildren(...[
      h("div", { class: "chg-sect" }, w.goes),
      plan.goes.length ? h("div", { class: "chg-block mv-files" }, ...plan.goes.map((/** @type {any} */ f) => fileRow(f, null))) : null,
      w.stays ? h("div", { class: "chg-sect" }, w.stays) : null,
      stays.length ? h("div", { class: "chg-block mv-files" }, ...stays.map((/** @type {any} */ f) => fileRow(f, f.why))) : null,
      ...[w.committed, w.others, w.ignored, ...w.running].filter(Boolean).map((line) => h("p", {}, line)),
    ].filter((el) => el != null));
    said.textContent = w.blocked;
    said.classList.toggle("is-err", !!w.blocked);
    ready(!w.blocked);
  }

  async function read() {
    const mine = ++reads;
    ready(false);
    const place = placeIn.value === NEW ? null : [...placeIn.querySelectorAll("option")].find((o) => o.getAttribute("value") === placeIn.value);
    // The name and what is copied are a new worktree's: they go with the choice, not with its read.
    nameIn.hidden = !!place;
    copy.el.hidden = !!place;
    waiting(`Reading what would go${place ? ` to ${place.textContent}` : ""}…`);
    try {
      const got = await api(`/sessions/${id}/move?${query()}`);
      if (mine !== reads) return;
      plan = got;
      draw();
    } catch (e) {
      if (mine !== reads) return;
      waiting(null);
      list.replaceChildren();
      whereLine.textContent = "";
      said.textContent = String(/** @type {any} */ (e)?.message || e);
      said.classList.add("is-err");
    }
  }

  async function go() {
    if (moving || !plan || plan.blocked?.length) return;
    moving = true;
    ready(false);
    waiting("Moving…");
    try {
      const move = api(`/sessions/${id}/move`, { method: "POST", body: { to: to(), files: plan.goes.map((/** @type {any} */ f) => f.path) } });
      onMoving?.(move);
      const done = await move;
      d.close(true);
      onMoved(done);
    } catch (e) {
      const err = /** @type {any} */ (e);
      moving = false;
      // A list that changed since this read comes back with the new read (GWC-167): shown, Move again to take it.
      if (err?.body?.plan) {
        plan = err.body.plan;
        draw();
      } else {
        waiting(null);
        ready(true);
      }
      said.textContent = String(err?.message || err);
      said.classList.add("is-err");
      onToast(String(err?.message || err), "err");
    }
  }

  placeIn.addEventListener("change", () => void read());
  nameIn.addEventListener("input", () => {
    madeName = false;
    if (rest) clearTimeout(rest);
    rest = setTimeout(() => void read(), READ_AFTER_MS);
  });
  nameIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void go();
    }
  });
  // The repository's other places, beside a new worktree (GW-D70): read again where the feed says they moved (the
  // server answers from its last read and reads again behind it), the one picked kept where it went.
  /** @type {any} */
  let places = null;
  const readPlaces = () =>
    api(`/git/places?cwd=${encodeURIComponent(like)}`)
      .then((/** @type {any} */ r) => {
        places = r;
        const here = placeKey(placeHolding(r?.places || [], like)?.path || "");
        const want = /** @type {any[]} */ (r?.places || []).filter((p) => p.ok && !p.missing && placeKey(p.path) !== here);
        const paths = new Set(want.map((p) => p.path));
        /** Each option, by the place it names: its `value` as `h` wrote it. */
        const options = () => [...placeIn.querySelectorAll("option")].map((o) => ({ o, at: o.getAttribute("value") || NEW }));
        for (const { o, at } of options()) if (at !== NEW && at !== placeIn.value && !paths.has(at)) o.remove();
        const shown = new Set(options().map((x) => x.at));
        for (const p of want) if (!shown.has(p.path)) placeIn.append(h("option", { value: p.path }, `${p.name || placeName(p.path)}${p.branch ? ` · ${p.branch}` : ""}`));
      })
      .catch(() => {});
  void readPlaces();
  const offPlaces = hear?.((msg) => {
    if (gitMovedFor(msg, "places", [like, places?.cwd, places?.main])) void readPlaces();
  }) || (() => {});
  copy.refresh();
  void read();
  return d;
}
