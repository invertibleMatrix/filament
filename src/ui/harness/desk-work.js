// @ts-check
// Bring changes back from the desk (the remote desk's s2d). A chat started with Run on works in a copy of a folder of
// the person's on another machine (app/remote-work.js); what it changes there waits in that copy until the person brings
// it back. This keeps this computer's records of them (GET /api/remote-work) and, as the app tells the page each
// machine's chats (lib/desk.js), looks at a chat whose turn ended since its last look — never while it works or waits
// for you, one look at a time, its machine answering (POST …/check, `seen` the chat's newest moment there) —; its row
// says what waits (`cardsOf` under its row in Now, `pill` on its row under its project). A look refused a moment (its
// turn still ran there, its machine cut off) is asked again after `LOOK_AGAIN_MS`; one refused for good, once the chat
// moves there. Bring back says what would come and what would stop it, a choice for each such file, and brings that
// capture in (POST …/back with its `at`) as uncommitted edits, nothing committed — changed there since, it says what
// comes now —: a second one brings only what changed since. While a turn of it runs there it says so.
import { h } from "../lib/dom.js";
import { choiceLabel, choicesFor, counted, kindWords, leaf, leftNote, markersWords } from "./lib/apply-words.js";

/** A look refused (its turn still runs, its machine cut off) is asked again no sooner. */
export const LOOK_AGAIN_MS = 30_000;
/** The records are read again, as the desk moves, no oftener. */
export const READ_AGAIN_MS = 60_000;
/** The files a Bring back names: the rest are counted. */
export const FILES_SHOWN = 40;

/**
 * A record as the desk keeps it: its id, its machine, its project and folder here, the chat there, its state, what waits
 * to come back as the last look found it, and the chat's newest moment there at that look (`seen`).
 * @typedef {{ id: string, machine: { id: string, name: string }, project: string, folder: string, chat: string,
 *   state: string, waiting: { at: string, files: number, conflicts: number } | null, seen: number }} Work
 */
/** What a look answers. @typedef {{ work: any, unchanged: boolean, files: { path: string, status: string, added: number, removed: number }[], count: number, came: any[], conflicts: any[], at: string, left: { path: string, why: string }[] }} Look */

/** @param {unknown} v */
const str = (v) => (typeof v === "string" ? v : "");
/** @param {unknown} v */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Records as this computer says them, each field checked. @param {unknown} json @returns {Work[]}
 */
export function readWorks(json) {
  const list = /** @type {any} */ (json)?.works;
  if (!Array.isArray(list)) return [];
  return list
    .filter((w) => w && typeof w.id === "string" && typeof w.machine?.id === "string")
    .map((w) => ({
      id: w.id,
      machine: { id: w.machine.id, name: str(w.machine.name) || "another machine" },
      project: str(w.project),
      folder: str(w.folder),
      chat: str(w.chat),
      state: str(w.state),
      waiting: w.waiting && num(w.waiting.files) > 0 ? { at: str(w.waiting.at), files: num(w.waiting.files), conflicts: num(w.waiting.conflicts) } : null,
      seen: num(w.seen),
    }));
}

/**
 * The records to look at now: a chat named there, its copy not gone, its machine answering, the chat in that machine's
 * list, neither at work (it, or a thread of it) nor waiting for you itself, its newest moment there moved since the last
 * look and since a look refused for good (`refused`, by the moment it was asked for), no look of it under way, none
 * refused a moment within `LOOK_AGAIN_MS` (`failed`). → each with the moment it is looked at for.
 * @param {readonly Work[]} works @param {import("./lib/desk.js").Desk | null} desk
 * @param {{ looking: ReadonlySet<string>, failed: ReadonlyMap<string, number>, refused?: ReadonlyMap<string, number>, now: number }} o
 * @returns {{ id: string, seen: number }[]}
 */
export function dueLooks(works, desk, { looking, failed, refused = new Map(), now }) {
  if (!desk) return [];
  /** @type {{ id: string, seen: number }[]} */
  const due = [];
  for (const w of works) {
    if (!w.chat || w.state === "gone" || w.state === "placed" || looking.has(w.id)) continue;
    if (now - (failed.get(w.id) ?? -Infinity) < LOOK_AGAIN_MS) continue;
    const m = desk.machines.find((x) => x.id === w.machine.id);
    if (!m || m.status !== "online") continue;
    if (m.rows.works.some((r) => r.there.chain === w.chat) || m.rows.needs.some((r) => r.there.chain === w.chat && !r.there.thread)) continue;
    const c = m.recent.find((x) => x.there.chain === w.chat);
    if (!c?.when || c.when === w.seen || c.when === refused.get(w.id)) continue;
    due.push({ id: w.id, seen: c.when });
  }
  return due;
}

/**
 * Whether a look refused so may mend by itself: its chat's turn still ran there, its machine was cut off or busy a
 * moment, or the call never reached this computer. Any other is refused until the chat moves there again.
 * @param {any} e
 */
export const mends = (e) => !e?.status || e.status === 503 || e.body?.kind === "runs" || e.body?.kind === "cut";

/** @param {number} n @param {string} one */
const many = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * What a record's mark says: how many files wait, where they go, how many would stop until the person chooses.
 * @param {Work} w @returns {{ label: string, title: string }}
 */
export function waitWords(w) {
  const n = w.waiting?.files ?? 0;
  const stop = w.waiting?.conflicts ?? 0;
  return {
    label: `${many(n, "file")} changed on ${w.machine.name}`,
    title: `${many(n, "file")} its chat changed on ${w.machine.name} wait${n === 1 ? "s" : ""} to come back into ${w.project || "your folder"}${stop ? ` — ${stop} overlap${stop === 1 ? "s" : ""} your edits, and you choose what comes` : ""}. Bring back brings them in as uncommitted edits.`,
  };
}

/**
 * What came back, said: how many files and how, those with conflict markers, what stayed there.
 * @param {Work} w @param {{ unchanged?: boolean, files?: any[], came?: any[], left?: any[] }} out
 */
export function cameWords(w, out) {
  if (out.unchanged) return `Nothing changed on ${w.machine.name} since ${w.state === "brought" ? "you last brought it back" : "it went"}.`;
  const n = counted(/** @type {any} */ (out.came || []));
  const files = out.files?.length || 0;
  const how = [
    n.took ? `${n.took} as it left ${n.took === 1 ? "it" : "them"}` : "",
    n.merged.length ? `${n.merged.length} merged with your edits` : "",
    n.replaced?.length ? `${n.replaced.length} taken as its` : "",
    n.kept?.length ? `${n.kept.length} kept as yours` : "",
    n.deleted ? `${n.deleted} deleted` : "",
  ].filter(Boolean);
  const marked = n.markers?.length ? ` ${markersWords(n.markers)}: resolve them and save.` : "";
  const left = leftNote(/** @type {any} */ (out.left), w.machine.name);
  return `${many(files, "file")} came back from ${w.machine.name} into ${w.project || "your folder"}${how.length > 1 || n.merged.length ? ` (${how.join(", ")})` : ""}, as uncommitted edits.${marked}${left ? ` ${left}` : ""}`;
}

/**
 * The desk's records and their looks, and Bring back. `api`: this computer's (lib/api.js); `toast`, `dialog`: the
 * page's; `onChange`: what a row says moved; `later`: the page's timer, a test's own.
 * @param {{ api: (path: string, init?: any) => Promise<any>, toast: (words: string, kind?: string) => void,
 *   dialog: (o: any) => { close: (force?: boolean) => void }, onChange: () => void, now?: () => number,
 *   later?: (fn: () => void, ms: number) => unknown }} io
 */
export function createDeskWork(io) {
  const now = io.now || Date.now;
  const later = io.later || ((fn, ms) => setTimeout(fn, ms));
  /** @type {Work[]} */
  let works = [];
  let readAt = -Infinity;
  /** @type {Promise<void> | null} */
  let reading = null;
  /** @type {Set<string>} */
  const looking = new Set();
  /** A look refused a moment, by when: asked again after `LOOK_AGAIN_MS`, the desk quiet or not. @type {Map<string, number>} */
  const failed = new Map();
  /** A look refused for good, by the chat's moment it was asked for: asked again once the chat moves there. @type {Map<string, number>} */
  const refused = new Map();
  /** When each record was last put from an answer: a read asked before then keeps it. @type {Map<string, number>} */
  const putAt = new Map();
  /** One look at a time. @type {Promise<unknown>} */
  let line = Promise.resolve();
  /** Bring backs under way, by record. @type {Set<string>} */
  const bringing = new Set();
  /** The desk as last told. @type {import("./lib/desk.js").Desk | null} */
  let desk = null;
  let rev = 0;
  const moved = () => {
    rev++;
    io.onChange();
  };
  /** A record this computer answered with, put in place of the one kept; told only where it moved. @param {unknown} raw */
  const put = (raw) => {
    const [w] = readWorks({ works: [raw] });
    if (!w) return;
    putAt.set(w.id, now());
    const had = works.find((x) => x.id === w.id);
    if (had && JSON.stringify(had) === JSON.stringify(w)) return;
    works = had ? works.map((x) => (x.id === w.id ? w : x)) : [w, ...works];
    moved();
  };
  /** The records read again: one put from an answer since the read was asked stays as put. */
  const load = () => {
    const asked = now();
    return (reading ??= io
      .api("/remote-work")
      .then((j) => {
        const read = readWorks(j).map((w) => ((putAt.get(w.id) ?? -Infinity) >= asked ? works.find((x) => x.id === w.id) ?? w : w));
        readAt = now();
        if (JSON.stringify(read) !== JSON.stringify(works)) {
          works = read;
          moved();
        }
        look();
      })
      .catch(() => void (readAt = now()))
      .finally(() => void (reading = null)));
  };
  /** The looks due now, each in its turn. */
  const look = () => {
    for (const d of dueLooks(works, desk, { looking, failed, refused, now: now() })) {
      looking.add(d.id);
      line = line.then(async () => {
        try {
          const out = await io.api(`/remote-work/${encodeURIComponent(d.id)}/check`, { method: "POST", body: { seen: d.seen } });
          failed.delete(d.id);
          refused.delete(d.id);
          put(out?.work);
        } catch (/** @type {any} */ e) {
          if (mends(e)) {
            // Asked again once the wait is past, whether or not the desk moves meanwhile.
            failed.set(d.id, now());
            later(() => look(), LOOK_AGAIN_MS + 100);
          } else refused.set(d.id, d.seen);
          // Its copy gone there, or its record here: read again.
          if (e?.status === 410 || e?.status === 404) void load();
        } finally {
          looking.delete(d.id);
        }
      });
    }
  };
  /** The record of a machine's chat, its copy not gone. @param {string} machine @param {string} chain */
  const of = (machine, chain) => works.find((w) => w.machine.id === machine && w.chat === chain && w.state !== "gone") ?? null;

  /**
   * What would come back and what would stop it, asked of the person; their Bring back brings it in. A file that stops
   * it takes their choice; one that changed there meanwhile is asked again.
   * @param {Work} w @param {Look} got @param {string} [note]
   * @returns {Promise<void>}
   */
  function ask(w, got, note = "") {
    return new Promise((resolve) => {
      /** @type {Map<string, string>} */
      const picks = new Map();
      let pressing = false;
      /** Asked again: this ask ends with that one, not as its dialog closes. */
      let again = false;
      const said = h("p", { class: "desk-work-said", role: "status" }, note);
      const shown = got.files.slice(0, FILES_SHOWN);
      const more = got.count - shown.length;
      const stops = got.conflicts.map((c) =>
        h("li", { class: "desk-work-stop" },
          h("span", { class: "desk-work-path", title: c.path }, h("b", {}, leaf(c.path)), ` — ${kindWords(c)}`),
          h("select", {
            class: "desk-work-pick",
            "aria-label": `What comes for ${c.path}`,
            onchange: (/** @type {any} */ e) => {
              const v = String(e.target?.value || "");
              if (v) picks.set(c.path, v);
              else picks.delete(c.path);
            },
          }, h("option", { value: "" }, "Choose…"), ...choicesFor(c).map((ch) => h("option", { value: ch }, choiceLabel(c.kind, ch))))));
      const left = leftNote(got.left, w.machine.name);
      const body = h("div", { class: "desk-work flex flex-col gap-2" },
        h("p", {}, `What its chat changed on ${w.machine.name} comes into ${w.folder || w.project || "your folder"} as uncommitted edits: nothing is committed, and your own edits stay, merged where you both changed a file.`),
        h("ul", { class: "desk-work-files" },
          ...shown.map((f) => h("li", {}, h("span", { class: "desk-work-st" }, f.status), h("span", { class: "desk-work-path", title: f.path }, f.path), h("span", { class: "desk-work-n" }, `+${f.added} −${f.removed}`))),
          more > 0 ? h("li", { class: "desk-work-more" }, `and ${many(more, "more file")}`) : null),
        stops.length ? h("p", {}, `${many(stops.length, "file")} overlap${stops.length === 1 ? "s" : ""} your edits: choose what comes for each.`) : null,
        stops.length ? h("ul", { class: "desk-work-stops" }, ...stops) : null,
        left ? h("p", { class: "desk-work-left" }, left) : null,
        said);
      const d = io.dialog({
        title: `Bring back ${many(got.count, "file")} from ${w.machine.name}?`,
        body,
        wide: true,
        actions: [
          { label: "Cancel", variant: "outline", onClick: () => d.close() },
          { label: "Bring back", onClick: () => void go() },
        ],
        // A bring back under way runs to its end: the dialog stays until it says what came.
        guard: () => !pressing,
        onClose: () => {
          if (!again) resolve();
        },
      });
      /** Asked again, once this dialog has gone: this ask ends with that one. @param {() => Promise<void>} next */
      const askAgain = (next) => {
        again = true;
        d.close(true);
        resolve(next());
      };
      async function go() {
        if (pressing) return;
        if (got.conflicts.some((c) => !picks.get(c.path))) {
          said.textContent = "Choose what comes for each file that overlaps your edits first.";
          return;
        }
        pressing = true;
        said.textContent = `Bringing it back from ${w.machine.name}…`;
        try {
          // The capture shown, and nothing else: one taken there since is shown again.
          const out = await io.api(`/remote-work/${encodeURIComponent(w.id)}/back`, { method: "POST", body: { at: got.at, ...(got.conflicts.length ? { choices: Object.fromEntries(picks) } : {}) } });
          put(out?.work);
          pressing = false;
          d.close(true);
          io.toast(cameWords(w, out));
        } catch (/** @type {any} */ e) {
          const b = e?.body;
          pressing = false;
          if (e?.status === 409 && b?.moved) {
            if (b.work) put(b.work);
            return askAgain(() => fresh(w.id, `It changed again on ${w.machine.name} since you looked: this is what comes now.`));
          }
          if (e?.status === 409 && Array.isArray(b?.conflicts) && b.conflicts.length) {
            if (b.work) put(b.work);
            // Your edits here moved meanwhile: what stops it now.
            return askAgain(() => ask(w, { ...got, conflicts: b.conflicts, at: String(b.at || got.at), left: b.left || got.left }, "These files overlap your edits now: choose what comes for each."));
          }
          said.textContent = String(b?.error || e?.message || e);
        }
      }
    });
  }

  /**
   * What waits looked at now, and what would come asked; nothing that changed said so. @param {string} id @param {string} [note]
   * @returns {Promise<void>}
   */
  async function fresh(id, note = "") {
    const w = works.find((x) => x.id === id);
    if (!w) return;
    /** @type {Look} */
    let got;
    try {
      got = await io.api(`/remote-work/${encodeURIComponent(id)}/check`, { method: "POST", body: {} });
    } catch (/** @type {any} */ e) {
      io.toast(String(e?.body?.error || e?.message || e), "err");
      if (e?.status === 410) void load();
      return;
    }
    put(got.work);
    if (got.unchanged) return void io.toast(cameWords(w, { unchanged: true }));
    await ask(works.find((x) => x.id === id) ?? w, got, note);
  }

  /** Bring back pressed: one at a time for a record. @param {string} id @returns {Promise<void>} */
  async function bringBack(id) {
    if (!works.some((x) => x.id === id) || bringing.has(id)) return;
    bringing.add(id);
    moved();
    try {
      await fresh(id);
    } finally {
      bringing.delete(id);
      moved();
    }
  }

  return {
    /** The desk as the app told it: the records read where they are old, and the looks due asked. @param {import("./lib/desk.js").Desk | null} d */
    sync(d) {
      desk = d;
      if (now() - readAt >= READ_AGAIN_MS) void load();
      else look();
    },
    /** The record of a machine's chat whose changes wait, else null. @param {string} machine @param {string} chain */
    waiting: (machine, chain) => {
      const w = of(machine, chain);
      return w?.waiting ? w : null;
    },
    bringBack,
    /** What the marks would draw, in a word: Now draws again where it moves. */
    key: () => `${rev}:${[...bringing].join(",")}`,
    /**
     * The card under another machine's row in Now whose chat's changes wait: what waits, and Bring back.
     * @param {import("./lib/desk.js").DeskRow} r @param {any} mk
     */
    cardsOf(r, mk) {
      // The chat's own row alone: a thread of it in Needs you is no second place for its card.
      const w = r.there.thread ? null : of(r.machine.id, r.there.chain);
      if (!w?.waiting) return [];
      const words = waitWords(w);
      const busy = bringing.has(w.id);
      return [
        mk("div", { class: `desk-ask desk-back${busy ? " is-busy" : ""}`, "data-key": `back:${w.id}` },
          mk("span", { class: "desk-ask-q", title: words.title }, words.label),
          mk("div", { class: "desk-ask-acts" },
            mk("button", { class: "desk-ask-btn is-go", type: "button", title: words.title, ...(busy ? { "aria-disabled": "true" } : {}), onclick: (/** @type {Event} */ e) => { e.stopPropagation(); void bringBack(w.id); } }, "Bring back"))),
      ];
    },
    /**
     * The mark on another machine's chat under its project whose changes wait: a press brings them back.
     * @param {string} machine @param {string} chain
     */
    pill(machine, chain) {
      const w = of(machine, chain);
      if (!w?.waiting) return null;
      const words = waitWords(w);
      return h("button", {
        class: "desk-back-pill",
        type: "button",
        title: words.title,
        "aria-label": `Bring back: ${words.label}`,
        onclick: (/** @type {Event} */ e) => {
          e.stopPropagation();
          void bringBack(w.id);
        },
        onkeydown: (/** @type {KeyboardEvent} */ e) => e.stopPropagation(),
      }, `↩ ${w.waiting.files}`);
    },
  };
}
