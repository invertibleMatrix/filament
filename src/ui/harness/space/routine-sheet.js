// @ts-check
// A routine's sheet (HarnessV4_Space_Plan S6, the mock "Space, grown" screen 11): Switch on… — everything a routine an
// agent proposed will do, in Filament's words, before it runs by itself (R1, S6-D1) — or, for one on, What it does. What
// it does, its words whole; when, with its first or next time; what it may do — it reads only, or works in a lane of
// its own —; the model it runs on and its effort, the person's to choose (the owner's word of 10-31): the one they
// chose for it, else its Space's (the owner's of 11-04: its Space settings, else Settings › Space), else its chat's as
// it proposed it, with its provider and whether it can run now — a pick is saved at once, and a change by its chat keeps
// it —; the chat it was made in, which a press opens. Its foot: Ask for a change… (that chat, its box begun: nothing
// is sent), Not now, and Switch on — the press, which waits for a model that can run. Nothing else here runs anything.
// A watcher's sheet says what waking does, by whom it wakes: a new chat each time, as a routine's run; a turn in the
// chat that proposed it, on that chat's own model; or a row in Needs you, no agent run — and what runs all the same,
// in the server's words (`words.told`). Only the first runs on a model of its own: the others show none, and their
// Switch on waits for none.
// A watcher whose trigger runs a program (`words.script`) says What it runs between When and What it may do: its
// command, how it is run, the files Switch on approves by their content — each opens, read only, as it is on the disk
// —, the secrets it is handed by name, those with no value marked, and that it runs as the person. The press is of what
// the sheet showed: it reads a seal over those files as it opens (`GET …/script`), Switch on waits for it and sends it
// back, and a press the server refuses — a file moved meanwhile — draws the sheet again on what it runs.
// A watcher a program posts to (`words.webhook`) has Its address: said before Switch on; for one on, read by the
// person's press (`GET …/address`) and shown in fields to copy, with its secret the one time it comes, an example to
// paste, its bounds, and Make a new address…. Switched on, its sheet stays and becomes What it does, the address in
// sight. The address and the secret stand in those fields alone: in no tip, no attribute, no toast.
// All of it is one view (`routineView`), which the Space's sheet stands in a sheet and the card under the call that
// proposed it stands in the chat (the owner's of 11-12: a watcher is proposed in the chat).
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { confirmDialog, sheet, toast } from "../lib/ui.js";
import { routineAskWords, sizeWords } from "../lib/space-view.js";
import { createModelSelect } from "../composer/model.js";
import { fitEffort, modelRow } from "./model-row.js";

/**
 * A routine as the Space says it (`GET /space/:project`'s `runs.routines`): as kept, with its project, the name of the
 * chat that made it, and its row's words — Filament's, as the page reads no core. `at`: when its chat proposed or last
 * changed it, which Switch on sends back: the press is of what the sheet showed. `wakes`: a watcher's — a new chat, the
 * chat that proposed it, or only you; `trigger`: what wakes it, there for a watcher alone; `guides`: it may write to
 * the chat its trigger names. `runsOn`, `spaceOn`: said of what runs in a chat of its own. `pausedWhy`: why Filament
 * paused it itself. Its words: a watcher's parts apart — what it `watches`, whom it `wakes` under its label, what it
 * `guides`, each chat they name kept apart (`Named`) —; `lastParts`, its last run with the one word of its state
 * between; `heard`, for a watcher that listens and never ran; `reviewed`, how many turns a watcher read today;
 * `idle`, what one on says with nothing coming; `told`, of a watcher that tells only you, what runs; `press`, what
 * each press on its row does, by what it is (core/routines.js `pressWords`); `script`, of a watcher that runs a program,
 * what it runs (core/watchers.js `scriptSheet`); `webhook`, of one a program posts to, what is said of its address
 * (`webhookSheet`).
 * @typedef {(string | { chain: string, name: string })[]} Named
 * @typedef {{ command: string[], said: string, how: string, files: string[], approves: string, secrets: string[], handed: string, unkept: string[], unkeptWords: string, runs: string }} ScriptWords
 * @typedef {{ made: string, signed: string, header: string, bounds: string }} WebhookWords
 * @typedef {{ id: string, title: string, when: string, task: string, writes: boolean, acts?: string[], trigger?: { kind: string }, wakes?: "new" | "chat" | "you", guides?: boolean, state: "proposed" | "on" | "removed",
 *   paused: boolean, pausedWhy?: string, madeIn: string, madeBy: string, madeName: string, model: string, modelBy?: "you", effort?: string, project: string,
 *   at: number,
 *   runsOn?: { model: string, effort: string, from: "routine" | "space" | "default" | "proposed" | "" },
 *   spaceOn?: { model: string, effort: string, from: "space" | "default" | "" },
 *   last: { at: number, chain: string, by: "time" | "you" | "agent" | "event", state: string, said?: string, why?: string } | null,
 *   words: { when: string, may: string, allowed: string, last: string, tone: string, said: string, ran: string, why: string,
 *     skipped: string, next: string, nextAt: number | null, first: string, idle: string, heard: string, reviewed?: string, told?: string,
 *     watches: Named | null, wakes: { label: string, parts: Named } | null, guides: Named | null,
 *     lastParts: { head: string, word: string, tail: string, tone: string } | null,
 *     press: { on: string, what: string, run: string, pause: string, resume: string, back: string, remove: string, removed: string, more: string, chose: string },
 *     script?: ScriptWords, webhook?: WebhookWords } }} RoutineRow
 */
/**
 * What a script watcher's sheet reads as it opens (`GET …/routines/:id/script`): the seal of what a Switch on would
 * pin, and its files — each not as approved says how, and `differs` what Filament does about it. One of them read
 * (`?file=`): its text, `cut` where it is longer, or why it is not shown (`unread`).
 * @typedef {{ seal: string, files: { path: string, bytes: number | null, changed?: string }[], differs?: string }} Approval
 * @typedef {{ path: string, text?: string, cut?: boolean, bytes?: number, unread?: string }} FileRead
 * @typedef {{ url: string, urlTailnet?: string, sign: string | null, secret?: string }} Address  a webhook watcher's
 *   address as its read and its renew answer it: `secret` the one time it is shown
 * @typedef {(method: string, path: string, body?: any) => Promise<{ ok: true, got: any } | { ok: false, error: string }>} SheetRequest
 *   a read or a press under the routine's own path — `/script`, `/address`, `/address/renew` —, a refusal answered
 *   in the server's words: the sheet says it in its place, and no toast does
 */

/** How many of a script watcher's files its sheet lists before Show all. */
const FILES_SHOWN = 8;

/**
 * What stands in a field, copied by the person's press: the toast names what it was and holds none of it.
 * @param {string} value @param {string} what  what it is, as a sentence names it: "the address"
 */
function copy(value, what) {
  if (!navigator.clipboard?.writeText) return toast(`This page cannot copy: select ${what} and copy it`, "err");
  navigator.clipboard.writeText(value).then(
    () => toast(`${what[0].toUpperCase()}${what.slice(1)} is copied`),
    () => toast(`It was not copied: select ${what} and copy it`, "err"),
  );
}

/** A place for what is there only at times: put away while it holds nothing. */
const slot = () => /** @type {HTMLElement} */ (h("div", { class: "srs-slot" }));
/** @param {HTMLElement} el @param {any[]} nodes */
const fill = (el, nodes) => {
  el.replaceChildren(...nodes);
  el.hidden = !nodes.length;
};

/**
 * What a routine's sheet asks of its host. `readOnly`: What it does, for one on. `switchOn`: the press, with the seal a
 * script watcher's sheet read — its answer, true where it was taken (a refusal is the caller's to say); the host lets
 * it go then (`done`), but a webhook watcher's, which becomes its What it does. `chooseModel`: the model its runs start
 * on and its effort, the person's pick saved ("" its Space's model), its answer as Switch on's; `catalogue` and
 * `modelSelect`: the models it may run on, and the picker that lists them (a test's stand-in). `space`: what its Space's
 * agents run on (the owner's of 11-04) — its Use the default —, and `nameOf` a model's name as the picker says it.
 * `request`: the sheet's own reads and its Make a new address… (`SheetRequest`); `stands`: the routine as the Space says
 * it at that moment, which a drawing after a press is of; `focus`: "address" brings Its address in sight as it lands.
 * `here`: the chat it is drawn in, where Made in would only name itself (a chat's card under its call).
 * @typedef {{ r: RoutineRow, place: string, readOnly?: boolean, switchOn?: (seal?: string) => Promise<boolean>,
 *   chooseModel?: (model: string, effort: string) => Promise<boolean>, catalogue?: import("./model-row.js").Catalogue, modelSelect?: typeof createModelSelect,
 *   space?: { model: string, effort: string, from: "space" | "default" | "" }, nameOf?: (model: string) => string,
 *   openChat?: (chain: string) => void, askChat?: (chain: string, words: string) => void,
 *   request?: SheetRequest, stands?: () => RoutineRow | undefined, focus?: "address", here?: string }} SheetOpts
 * Why the view lets go of itself, for its host to act on: Switch on taken (`on`), Not now or Close (`leave`), Made in
 * pressed (`chat`), Ask for a change… pressed (`ask`).
 * @typedef {"on" | "leave" | "chat" | "ask"} LetGo
 */

/**
 * The sheet, open: the view (`routineView`) in a sheet of its own, which each way it lets go of itself closes.
 * @param {SheetOpts} o
 */
export function routineSheet(o) {
  /** @type {{ el: HTMLElement, close: () => void } | null} */
  let s = null;
  const v = routineView({
    ...o,
    done: () => s?.close(),
    // Drawn again under an open sheet: its name follows its title.
    retitled: (title) => s?.el.querySelector(".zc-sheet")?.setAttribute("aria-label", title),
  });
  s = sheet({ label: v.title, class: "sdb-keep-sheet srt-sheet", head: v.head, body: v.body, foot: v.foot, onClose: () => v.close() });
  return s;
}

/**
 * Everything a routine's sheet says and presses, as three places a host stands where it likes — the Space's sheet, the
 * card under the call that proposed it in a chat (the owner's of 11-12: a watcher is proposed in the chat). `done`:
 * the view lets go of itself, and why (`LetGo`); `retitled`: its title, where a press drew it again in place. `close`:
 * the host let it go, and what a drawing asked for lands nowhere after.
 * @param {SheetOpts & { done?: (why: LetGo) => void, retitled?: (title: string) => void }} o
 * @returns {{ head: HTMLElement, body: HTMLElement, foot: HTMLElement, title: string, close: () => void }}
 */
export function routineView({ r: first, place, readOnly: firstReadOnly = false, switchOn, chooseModel, catalogue, modelSelect = createModelSelect, space = { model: "", effort: "", from: "" }, nameOf = (m) => m, openChat, askChat, request, stands, focus: firstFocus, here, done = () => {}, retitled }) {
  let open = true;
  // The sheet's three places, made once: what stands in them is drawn again where the routine moved under the sheet.
  const head = h("b", { class: "sp-sheet-title" });
  const body = h("div", { class: "sdb-keep-body srt-sheet-body" });
  const foot = h("div", { class: "sdb-keep-foot" });
  /** How many times the sheet was drawn: what a drawing asked for lands only while that drawing stands. */
  let drawn = 0;
  /** @param {string} name @param {...any} value */
  const part = (name, ...value) => [h("h4", { class: "sdb-keep-h" }, name), h("div", { class: "srt-sheet-v" }, ...value)];
  /** @type {SheetRequest} */
  const ask = (method, path, sent) => (request ? request(method, path, sent) : Promise.resolve({ ok: false, error: "This page cannot read it." }));

  /**
   * What a script watcher runs (`words.script`): its command and how it is run; the files Switch on approves, or
   * approved — each a row that opens the file's text under it, read as it is on the disk —, and what that approval
   * means; the secrets it is handed, by name, one with no value kept marked and said; and whom it runs as. `load`
   * reads what a Switch on would approve; `state` says where that read stands, and `seal` what it read.
   * @param {RoutineRow} r @param {boolean} readOnly @param {() => boolean} alive @param {() => void} moved
   */
  function scriptPart(r, readOnly, alive, moved) {
    const sw = /** @type {ScriptWords} */ (r.words.script);
    /** What the sheet read of its approval; null while it reads. @type {{ ok: true, got: Approval } | { ok: false, error: string } | null} */
    let read = null;
    let all = false;
    /** The files opened, each with what was read of it: null while it is read. @type {Map<string, { ok: true, got: FileRead } | { ok: false, error: string } | null>} */
    const opened = new Map();
    /** Each file's row, made once for its path: its press keeps the focus as what stands under it is drawn. @type {Map<string, { li: HTMLElement, open: HTMLElement, meta: HTMLElement, fold: HTMLElement }>} */
    const rows = new Map();
    const list = /** @type {HTMLElement} */ (h("ul", { class: "sdb-keep-list srs-files", "aria-label": readOnly ? "The files you approved" : "The files Switch on approves" }));
    const more = slot();
    const failed = slot();
    const differs = slot();
    /** @param {string} path */
    const rowOf = (path) => {
      const had = rows.get(path);
      if (had) return had;
      // Its chevron turns with `aria-expanded` (space.css).
      const opener = /** @type {HTMLElement} */ (h("button", { class: "srs-file-open", type: "button", onclick: () => void toggle(path) },
        h("span", { class: "srs-chev", "aria-hidden": "true", html: ICONS.chevronRight }), h("code", { class: "sdb-cmd srs-path" }, path)));
      const meta = /** @type {HTMLElement} */ (h("span", { class: "srs-file-meta" }));
      const fold = /** @type {HTMLElement} */ (h("div", { class: "srs-fold" }));
      const row = { li: /** @type {HTMLElement} */ (h("li", { class: "sdb-keep-line srs-file", "data-path": path }, h("div", { class: "srs-file-line" }, opener, meta), fold)), open: opener, meta, fold };
      rows.set(path, row);
      return row;
    };
    /** What stands under an opened file: its text, cut where it is long; why it is not shown; or why it could not be read. @param {{ ok: true, got: FileRead } | { ok: false, error: string } | null} o */
    const under = (o) => {
      if (!o) return [h("p", { class: "sp-quiet srs-reading" }, "Reading it…")];
      if (!o.ok) return [h("span", { class: "sdb-secret-err srs-file-err", role: "alert" }, o.error)];
      if (typeof o.got.text !== "string") return [h("p", { class: "sp-quiet srs-unread" }, o.got.unread || "It is not shown.")];
      return [
        h("pre", { class: "srs-text", tabindex: "0" }, o.got.text),
        ...(o.got.cut ? [h("p", { class: "sp-quiet srs-cut" }, `Its first ${o.got.text.length.toLocaleString("en-US")} characters: the file is longer.`)] : []),
      ];
    };
    const paint = () => {
      const files = read?.ok ? read.got.files : sw.files.map((path) => ({ path, bytes: null, changed: undefined }));
      // A read that failed stands in the files' place: what cannot be read is listed as nothing to approve.
      const shown = read && !read.ok ? [] : all ? files : files.slice(0, FILES_SHOWN);
      for (const f of shown) {
        const row = rowOf(f.path);
        const is = opened.has(f.path);
        row.open.setAttribute("aria-expanded", String(is));
        row.meta.replaceChildren(
          ...(f.bytes != null ? [h("span", { class: "sp-quiet srs-bytes" }, sizeWords(f.bytes))] : []),
          ...(f.changed ? [h("span", { class: "srs-changed" }, f.changed)] : []));
        fill(row.fold, is ? under(opened.get(f.path) ?? null) : []);
      }
      // The rows stand as they are while the same files are listed: one in the focus keeps it.
      const paths = shown.map((f) => f.path).join("\n");
      if (list.dataset.paths !== paths) {
        list.dataset.paths = paths;
        list.replaceChildren(...shown.map((f) => rowOf(f.path).li));
      }
      list.hidden = !shown.length;
      fill(more, read?.ok !== false && !all && files.length > FILES_SHOWN
        ? [h("button", { class: "sb-more srs-all", type: "button", onclick: () => {
            all = true;
            paint();
            rowOf(files[FILES_SHOWN].path).open.focus();
          } }, `Show all ${files.length} files`)]
        : []);
      fill(failed, read && !read.ok ? [h("span", { class: "sdb-secret-err srs-err", role: "alert" }, read.error)] : []);
      fill(differs, read?.ok && read.got.differs ? [h("p", { class: "sp-quiet sdb-keep-note srs-differs" }, read.got.differs)] : []);
    };
    /** A file's row opened — its text read as it is on the disk — or folded. @param {string} path */
    async function toggle(path) {
      if (opened.has(path)) {
        opened.delete(path);
        return paint();
      }
      opened.set(path, null);
      paint();
      const got = await ask("GET", `/script?file=${encodeURIComponent(path)}`);
      // Folded, or opened anew, while it was read: this answer is no one's.
      if (!alive() || opened.get(path) !== null) return;
      opened.set(path, got);
      paint();
    }
    /** What a Switch on would approve, read: the press waits for it. */
    async function load() {
      read = null;
      opened.clear();
      paint();
      moved();
      const got = await ask("GET", "/script");
      if (!alive()) return;
      read = got.ok && typeof got.got?.seal === "string" && Array.isArray(got.got.files) ? got : got.ok ? { ok: false, error: "What it runs did not read as its files." } : got;
      paint();
      moved();
    }
    paint();
    return {
      nodes: [
        h("h4", { class: "sdb-keep-h" }, "What it runs"),
        h("div", { class: "srt-sheet-v srs-runs" }, h("code", { class: "sdb-cmd srs-cmd" }, sw.said), h("div", { class: "sp-quiet srs-how" }, sw.how)),
        h("h4", { class: "sdb-keep-h" }, readOnly ? "Approved when you switched it on" : "Switch on approves"),
        list,
        more,
        failed,
        h("p", { class: "sp-quiet sdb-keep-note srs-approves" }, sw.approves),
        differs,
        ...(sw.secrets.length
          ? [h("h4", { class: "sdb-keep-h" }, "Handed to it"),
              h("div", { class: "srt-sheet-v srs-secrets" }, ...sw.secrets.map((name) => h("code", { class: `sdb-cmd srs-secret${sw.unkept.includes(name) ? " is-unkept" : ""}` }, name))),
              h("p", { class: "sp-quiet sdb-keep-note srs-handed" }, sw.handed),
              ...(sw.unkeptWords ? [h("p", { class: "sp-quiet sdb-keep-note srs-unkept" }, sw.unkeptWords)] : [])]
          : []),
        h("div", { class: "srs-as" }, h("span", { class: "srs-as-ic", "aria-hidden": "true", html: ICONS.shieldAlert }), sw.runs),
      ],
      load,
      /** Where the read of what Switch on approves stands. @returns {"reading" | "ok" | "failed"} */
      state: () => (!read ? "reading" : read.ok ? "ok" : "failed"),
      seal: () => (read?.ok ? read.got.seal : ""),
    };
  }

  /**
   * Its address, a webhook watcher's (`words.webhook`). Proposed: where it will be made and answer, and how its posts
   * are signed — it has none yet, and none is read. On: the address read by the person's press and shown in a field
   * with Copy; its tailnet's the same where it has one; its secret the one time it comes; an example to paste, or the
   * header a signed post carries; its bounds; and Make a new address…, behind its word. A refusal of the read stands
   * in the part's place, one of the renew beside its button, each in the server's words.
   * @param {RoutineRow} r @param {() => boolean} alive @param {boolean} inSight
   */
  function addressPart(r, alive, inSight) {
    const ww = /** @type {WebhookWords} */ (r.words.webhook);
    const box = /** @type {HTMLElement} */ (h("div", { class: "srt-sheet-v srw" }));
    const nodes = [h("h4", { class: "sdb-keep-h" }, "Its address"), box];
    if (r.state !== "on") {
      box.append(h("span", { class: "sp-quiet srw-made" }, ww.made), ...(ww.signed ? [h("span", { class: "sp-quiet srw-signed" }, ww.signed)] : []));
      return { nodes, load: () => {} };
    }
    /** The address as the server last answered it: kept here and in its fields, and nowhere else. @type {Address | null} */
    let address = null;
    let refused = "";
    let renewRefused = "";
    let renewing = false;
    const fields = /** @type {HTMLElement} */ (h("div", { class: "srw-fields" }));
    const renewSaid = /** @type {HTMLElement} */ (h("span", { class: "srw-renew-said" }));
    const renewBtn = /** @type {HTMLElement} */ (h("button", { class: "ghost sm srw-renew", type: "button", onclick: () => void renew() }, "Make a new address…"));
    const renewRow = /** @type {HTMLElement} */ (h("div", { class: "srw-renew-row" }));
    box.append(fields, renewRow);
    /** @param {string} words */
    const label = (words) => h("span", { class: "sp-quiet srw-label" }, words);
    /** A value in its field, one line, with Copy beside it. @param {string} cls @param {string} value @param {string} what */
    const field = (cls, value, what) => h("div", { class: "sdb-hook-row srw-row" },
      h("code", { class: `sdb-cmd srw-field ${cls}`, tabindex: "0" }, value),
      h("button", { class: "ghost sm srw-copy", type: "button", "aria-label": `Copy ${what}`, onclick: () => copy(value, what) }, "Copy"));
    const paint = () => {
      const a = refused ? null : address;
      fields.replaceChildren(...(refused
        ? [h("span", { class: "sdb-secret-err srw-err", role: "alert" }, refused)]
        : !a
          ? [h("span", { class: "sp-quiet srw-reading" }, "Reading its address…")]
          : [
              field("srw-url", a.url, "the address"),
              ...(a.urlTailnet ? [label("From its tailnet"), field("srw-tailnet", a.urlTailnet, "the tailnet's address")] : []),
              ...(a.secret ? [label("Its secret"), field("srw-secret", a.secret, "the secret"), h("p", { class: "sp-quiet srw-once" }, "Shown this once: copy it now. Make a new address… gives another.")] : []),
              ...(a.sign
                ? [h("p", { class: "sp-quiet srw-header" }, ww.header)]
                : [label("To try it"), field("srw-example", `curl -X POST "${a.url}" -H "content-type: application/json" -d '{"status":"red"}'`, "the example")]),
              h("p", { class: "sp-quiet srw-bounds" }, ww.bounds),
            ]));
      // Make a new address… stands while there is one to replace, its button the same one: it keeps the focus.
      if (!!a !== !renewRow.hidden) fill(renewRow, a ? [renewBtn, renewSaid] : []);
      fill(renewSaid, renewRefused ? [h("span", { class: "sdb-secret-err srw-renew-err", role: "alert" }, renewRefused)] : []);
      // Busy, not disabled: a second press is dropped (`renewing`), and the button keeps the focus its confirm gave back.
      renewBtn.setAttribute("aria-busy", String(renewing));
    };
    /** @param {any} got @returns {Address | null} */
    const read = (got) => (typeof got?.url === "string" && got.url
      ? { url: got.url, sign: got.sign || null, ...(typeof got.urlTailnet === "string" && got.urlTailnet ? { urlTailnet: got.urlTailnet } : {}), ...(typeof got.secret === "string" && got.secret ? { secret: got.secret } : {}) }
      : null);
    /** Make a new address…: behind its word; the new one, and its secret, in the old one's place. */
    async function renew() {
      if (renewing) return;
      const ok = await confirmDialog({ title: `Make a new address for “${r.title}”?`, description: "The old address stops at once: whatever posts to it must be given the new one.", confirmLabel: "Make a new address", destructive: true });
      if (!ok || !alive()) return;
      renewing = true;
      paint();
      const got = await ask("POST", "/address/renew", {});
      renewing = false;
      if (!alive()) return;
      const made = got.ok ? read(got.got) : null;
      if (made) address = made;
      renewRefused = made ? "" : got.ok ? "The new address did not read as one." : got.error;
      paint();
    }
    async function load() {
      paint();
      const got = await ask("GET", "/address");
      if (!alive()) return;
      address = got.ok ? read(got.got) : null;
      refused = address ? "" : got.ok ? "Its address did not read as one." : got.error;
      paint();
      if (inSight) box.scrollIntoView({ block: "nearest" });
    }
    renewRow.hidden = true;
    return { nodes, load };
  }

  /**
   * The sheet drawn of a routine as it stands: its title, its parts, its foot. Drawn again in place where a press
   * moved the routine under it: a webhook watcher switched on, and a Switch on the server refused.
   * @param {RoutineRow} r @param {boolean} readOnly @param {"address"} [focus]
   * @returns {string} its title
   */
  function draw(r, readOnly, focus) {
    const mine = ++drawn;
    const alive = () => open && mine === drawn;
    const w = r.words;
    const go = /** @type {HTMLButtonElement} */ (h("button", { class: "sm primary srt-on", type: "button" }, "Switch on"));
    let switching = false;
    let saving = false;
    const script = w.script ? scriptPart(r, readOnly, alive, () => paintGo()) : null;
    const address = w.webhook ? addressPart(r, alive, focus === "address") : null;
    // Whom it wakes, a watcher's; "" for a routine at times. A run in a chat of its own — a routine's, a watcher's that
    // wakes a new chat — runs on a model the person may choose.
    const wakes = r.trigger ? r.wakes || "new" : "";
    const ownChat = !wakes || wakes === "new";
    /** What it runs on, and whose that is: as the server read it, else as it is kept. */
    const at = r.runsOn || { model: r.model, effort: r.effort || "", from: r.model ? (r.modelBy === "you" ? "routine" : "proposed") : "" };
    /** Whose the model shown is, in words: the person's own choice as the server says it, of a routine or a watcher. @param {string} from */
    const wordsOf = (from) =>
      from === "routine" ? w.press.chose
      : from === "space" ? "This Space's model, from its Space settings"
      : from === "default" ? "Every Space's model, from Settings › Space"
      : from === "proposed" ? `The model ${here && r.madeIn === here ? "this chat" : r.madeName || r.madeBy || "its chat"} ran on when it proposed it`
      : "No model yet: choose one, or set one for every Space in Settings › Space";
    /** The model's row, where it runs on one of its own. @type {ReturnType<typeof modelRow> | null} */
    const runsOn = !ownChat ? null : modelRow({
      named: `The model “${r.title}” runs on`, cls: "srt-model-why", catalogue, modelSelect,
      blank: "Choose a model",
      defaultDesc: space.model ? `This Space's model: ${nameOf(space.model)}${space.effort ? ` · ${space.effort}` : ""}` : `The model ${place}'s agents run on, once one is set in Settings › Space`,
      alive,
      onPick: (name) => void choose(name, fitEffort(catalogue, name, runsOn?.effort() || "")),
      onDefault: () => void choose("", ""),
      effort: chooseModel ? { onPick: (level) => void choose(runsOn?.model() || "", level), named: `The effort “${r.title}” runs at` } : null,
      changed: () => paintGo(),
    });
    /**
     * Switch on waits for a model that can run, where it runs on one, and for a pick being saved; a script watcher's,
     * for the read of what the press approves — one that failed leaves nothing to approve.
     */
    const paintGo = () => {
      const held = saving || (!!runsOn && !runsOn.ready());
      const sealed = script ? script.state() : "ok";
      go.disabled = switching || held || sealed !== "ok";
      go.title = saving ? "Saving the model it runs on…" : held ? "Choose a model it can run on first"
        : sealed === "reading" ? "Reading what Switch on would approve…"
        : sealed === "failed" ? "What it runs could not be read: nothing can be approved" : "";
    };
    /** What it runs on shown, with whose it is. @param {{ model: string, effort: string, from: string }} x */
    const shown = (x) => runsOn?.show(x.model, wordsOf(x.model ? x.from : ""), x.effort);
    /** What it runs on once "" — Use the default — is its pick: its Space's. */
    const spaceOn = () => ({ model: space.model, effort: space.model ? space.effort : "", from: space.model ? space.from : "" });
    let now = { model: at.model, effort: at.effort, from: at.from };
    /**
     * The person's pick, saved — "" its Space's model —; refused, what it ran on before is shown again.
     * @param {string} name @param {string} level
     */
    const choose = async (name, level) => {
      if (!chooseModel || saving || !runsOn) return;
      const was = now;
      saving = true;
      now = name ? { model: name, effort: level, from: "routine" } : spaceOn();
      shown(now);
      runsOn.hold("Saving your choice…");
      const ok = await chooseModel(name, name ? level : "");
      saving = false;
      runsOn.hold(null);
      if (!ok) shown((now = was));
      paintGo();
    };
    shown(now);
    if (!chooseModel) runsOn?.hold("Its chat's Ask for a change… changes it");
    // What happens once it is on: a routine runs at its times; a watcher is woken by what it watches, and what waking
    // does goes by whom it wakes — where it tells only you, what runs is the server's to say (`told`).
    const how = !wakes ? `it runs by itself at its times, each run a new chat of ${place}`
      : wakes === "chat" ? `when what it watches happens, Filament starts a turn in ${r.madeName || r.madeBy || "the chat that proposed it"}`
      : wakes === "you" ? `when what it watches happens, Filament tells you in Needs you: ${w.told || "nothing runs"}`
      : `when what it watches happens, Filament runs it, each run a new chat of ${place}`;
    body.replaceChildren(
      h("p", { class: "sdb-keep-lead" }, readOnly
        ? `${how[0].toUpperCase()}${how.slice(1)}. This is everything it does; a change by its chat switches it off until you switch it on again.`
        : `Once you switch it on, ${how}. This is everything it will do; a change by its chat switches it off until you switch it on again.`),
      // A watcher that tells only you may have no words of its own: no agent reads any.
      ...(r.task ? part("What it does", h("p", { class: "srt-sheet-task" }, r.task)) : []),
      ...part("When", w.when, h("span", { class: "sp-quiet" }, r.state === "on" ? ` · ${w.next || w.idle}` : w.first ? ` · its first time: ${w.first}` : "")),
      ...(script ? script.nodes : []),
      ...(address ? address.nodes : []),
      ...part("What it may do", w.allowed),
      // The connections' tools it calls without asking (A2c), each by its connection and tool: what Switch on lets it do.
      ...(r.acts?.length
        ? part("Acts without asking through", h("ul", { class: "srt-tools" }, ...r.acts.map((a) => {
            const [, server = a, tool = ""] = /^mcp__(.+?)__(.+)$/.exec(a) || [];
            return h("li", {}, h("b", {}, server), tool ? ` · ${tool}` : "");
          })))
        : []),
      ...(runsOn ? part("Runs on", runsOn.row) : []),
      // Drawn in the chat that made it, Made in would name that chat itself.
      ...(here && r.madeIn === here
        ? []
        : part("Made in",
          openChat
            ? h("button", { class: "sb-more srt-made", type: "button", title: `Open ${r.madeName}`, onclick: () => { done("chat"); openChat(r.madeIn); } }, r.madeName || r.madeBy || "its chat")
            : r.madeName || r.madeBy || "its chat")));
    const change = askChat
      ? h("button", { class: "ghost sm srt-ask", type: "button", title: here && r.madeIn === here ? "Your ask in this chat's box: nothing is sent until you send it" : `Opens “${r.madeName}”, which made it, with your ask in its box: nothing is sent until you send it there`, onclick: () => { done("ask"); askChat(r.madeIn, routineAskWords(r)); } }, "Ask for a change…")
      : null;
    const title = readOnly ? `What “${r.title}” does` : `Switch on “${r.title}”?`;
    go.addEventListener("click", async () => {
      if (!switchOn || go.disabled) return;
      switching = true;
      paintGo();
      const ok = await switchOn(script ? script.seal() : undefined);
      switching = false;
      // Closed meanwhile, or drawn again: this press's answer is no drawing's to act on.
      if (!alive()) return;
      // Switched on, a watcher a program posts to has its address from this moment: its sheet stays, as What it does.
      if (ok && w.webhook) return void draw({ ...(stands?.() || r), state: "on", paused: false }, true, "address");
      if (ok) return void done("on");
      // Refused, with the files a press approves: the sheet is drawn on what it runs as the Space says it, read again.
      const stood = stands?.();
      if (script) return void draw(stood?.state === "proposed" && stood.words.script ? stood : r, false);
      paintGo();
    });
    // Where its presses are once it is on, in Filament's words for what it is: a routine's in its ⋯; a watcher's row has
    // a switch for Pause, and no Run now where it tells only you.
    const more = w.press.more;
    const leave = h("button", { class: readOnly ? "sm" : "ghost sm", type: "button", onclick: () => done("leave") }, readOnly ? "Close" : "Not now");
    foot.replaceChildren(
      h("span", { class: "sp-quiet" }, readOnly ? `${more}.` : `${more} once it is on.`), h("span", { class: "sb-sp" }),
      ...(change ? [change] : []), leave, ...(readOnly ? [] : [go]));
    head.replaceChildren(title);
    // Drawn again in place: its host hears its title, and the focus has a press to stand on.
    if (mine > 1) {
      retitled?.(title);
      /** @type {HTMLElement} */ (leave).focus();
    }
    paintGo();
    void script?.load();
    void address?.load();
    return title;
  }

  const title = draw(first, firstReadOnly, firstFocus);
  return { head, body, foot, title, close: () => void (open = false) };
}
