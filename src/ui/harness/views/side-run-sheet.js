// @ts-check
// The side-run sheet (the Designer's of 10-27, built 10-28, on the owner's "i leave everything to you. go ahead"): the
// Plan page's "Run them in parallel…" opens it, and its Run starts the planner's own ready tasks on sub-agents itself —
// all or none, through the graph's side-run route, which claims them, so the agent is told to leave them. Every task's
// choices once at the top (the owner's of 10-29: six tasks drew the same four lines each and ran off the window): Runs
// on, the standard model picker, the chat agent's model first (the owner's word of 10-26: work the planner laid out runs
// on the planner's model); Works in, its own copy or your folder — fixed to your folder outside git, nothing where all
// only read; the Brief and When done where every task shares them. Then a row a task, in a list that scrolls: ticked or
// not, its name, what it writes and only what differs; its Change opens its own Runs on, Works in and Brief (Edit). The foot:
// the room the chat has, that they start now — mid-turn too: a choice to wait for the agent's turn to end, its default,
// left them unstarted for as long as a turn ran, hours for one that builds a whole plan (the owner's of 11-06) —, Ask
// your agent to run them instead — the sentence the offer sent before — and Cancel, Run N tasks. A change made in a copy waits there
// for its apply, your agent's or yours (the owner's of 11-02): nothing here chooses otherwise. A refusal is said in the
// sheet, never a toast.
import { h } from "../../lib/dom.js";
import { dialog, menu } from "../lib/ui.js";
import { api as apiDefault } from "../lib/api.js";
import { kids } from "../widgets/kit.js";
import { listWords } from "../lib/team.js";
import { leaf } from "../lib/apply-words.js";
import { createModelSelect } from "../composer/model.js";
import { prettyModel } from "../lib/families.js";
import { effortChip } from "../lib/effort-chip.js";
import { effortName } from "../lib/side.js";

/** What the sheet says mid-turn of a task that writes in your folder. */
export const YOURS_MID_WORDS = "Your agent is still working: a task in your folder writes beside it, in the files your agent may be editing now.";

/** @typedef {typeof h} Mk */
/**
 * @typedef {object} SideRow  one task's row as the sheet holds it: ticked, the model, where it works, and the brief —
 *   null where the task's own stands
 * @property {any} t
 * @property {boolean} on
 * @property {string} model
 * @property {"copy" | "yours"} folder
 * @property {{ goal: string, steps: string, acceptance: string } | null} brief
 * @property {boolean} editing
 * @property {boolean} [chose]  the developer picked where it works, apart from every task's: the room's read and every
 *   task's Works in no longer set it
 * @property {boolean} [ownModel]  it runs on a model of its own, apart from every task's
 * @property {string} [effort]  how hard it thinks, "" your agent's (the owner's word of 11-05: effort in every model picker)
 * @property {boolean} [ownEffort]  it thinks at a level of its own, apart from every task's
 * @property {boolean} [open]  its own Runs on, Works in and Brief are open
 */
/** @typedef {{ max: number, running: number, turn: boolean, repo: boolean, worktree: boolean }} SideFacts  the side-run route's GET */

/** Its files, short: "now.js, now-list.js" — the first three, then how many more. @param {readonly string[]} writes */
export const writesWords = (writes) => (writes.length ? `${writes.slice(0, 3).map(leaf).join(", ")}${writes.length > 3 ? ` and ${writes.length - 3} more` : ""}` : "");

/**
 * What its brief says, before an edit (the Designer's: a sub-agent's task needs goal, steps and done-when, the agent's
 * own need not): from the task — what it has — or thin, only its name and files.
 * @param {{ goal?: string, steps?: string[], acceptance?: string, writes?: string[] }} t @returns {{ thin: boolean, words: string }}
 */
export function briefOf(t) {
  const steps = Array.isArray(t.steps) ? t.steps.length : 0;
  const has = [t.goal ? "goal" : "", steps ? `${steps} ${steps === 1 ? "step" : "steps"}` : "", t.acceptance ? "done-when" : "", t.writes?.length ? "its files" : ""].filter(Boolean);
  if (!t.goal && !steps && !t.acceptance) return { thin: true, words: `Thin: only its name${t.writes?.length ? " and files" : ""}` };
  return { thin: false, words: `From the task: ${listWords(has)}` };
}

/**
 * What happens when it is done: one that only reads reports to your agent; one in your folder changes it as it goes;
 * one in its own copy waits there for its apply, your agent's or yours — its check run first, where it has one.
 * @param {{ writes?: string[], check?: string[] }} t @param {{ folder: "copy" | "yours" }} o
 */
export function whenDoneWords(t, { folder }) {
  if (!t.writes?.length) return "It reads only: its report goes to your agent";
  if (folder === "yours") return "Its changes land in your folder as it makes them";
  const check = Array.isArray(t.check) ? t.check : [];
  return `Waits in its copy for its apply, your agent's or yours${check.length ? ` — its check first (${check.join(", then ")})` : ""}`;
}

/**
 * The room line (the Designer's): "4 at once here · 1 runs · both fit", or "only 1 fits — untick one"; with no limit
 * (`max` none, as the side-room route says it now) "1 runs · both start now". `fits`: Run may go.
 * @param {{ max?: number | null, running: number }} room @param {number} n
 */
export function roomWords(room, n) {
  // No number of the chat's own (the owner's of 11-05): how many are at work, as the Agents tab says it.
  if (room.max == null) return { fits: true, words: `${room.running ? `${room.running} at work` : "None at work"} · ${n === 1 ? "it starts" : n === 2 ? "both start" : `all ${n} start`} now` };
  const free = Math.max(0, room.max - room.running);
  const head = `${room.max} at once here · ${room.running} ${room.running === 1 ? "runs" : "run"}`;
  if (n <= free) return { fits: true, words: `${head} · ${n === 1 ? "it fits" : n === 2 ? "both fit" : `all ${n} fit`}` };
  return { fits: false, words: `${head} · ${free === 0 ? "none fits now — wait for one to finish" : `only ${free} ${free === 1 ? "fits" : "fit"} — untick ${n - free}`}` };
}

/**
 * The run's body for the route, from the rows ticked.
 * @param {readonly SideRow[]} rows @param {{ starts: "now" | "turn" }} o
 */
export function sideBody(rows, { starts }) {
  return {
    starts,
    tasks: rows
      .filter((r) => r.on)
      .map((r) => ({
        id: r.t.id,
        model: r.model,
        ...(r.effort ? { effort: r.effort } : {}),
        folder: r.folder,
        ...(r.brief ? { goal: r.brief.goal, steps: r.brief.steps.split("\n").map((s) => s.trim()).filter(Boolean), acceptance: r.brief.acceptance } : {}),
      })),
  };
}

/** The sentence the offer sent before, which "Ask your agent to run them instead" sends still. @param {readonly string[]} ids */
export const askSentence = (ids) => `Run ${listWords([...ids])} in parallel on sub-agents.`;

/**
 * The toast once the run went: what started, or waits for the turn's end — and each whose launch was refused, given back
 * to the agent (the Hunter's of 10-28).
 * @param {readonly string[]} ids @param {boolean} later @param {readonly { id: string, why: string }[]} refused
 */
export function sideStartedWords(ids, later, refused) {
  const went = later ? `${listWords([...ids])} start when your agent's turn ends` : `Started ${listWords([...ids])} on sub-agents`;
  if (!refused.length) return went;
  const back = refused.map((x) => `${x.id} did not start (${x.why})`).join("; ");
  return `${went}. ${back} — ${refused.length === 1 ? "it is" : "they are"} your agent's again.`;
}

/**
 * Open the sheet for the tasks the offer named.
 * @param {{ chainId: string, ids: string[], tasks: any[], model: string, models: () => any[], families?: () => any[], accounts?: () => any[],
 *   ask?: ((text: string, ids: string[]) => void) | null, started?: (o: { ids: string[], later: boolean, refused: { id: string, why: string }[] }) => void }} io
 *   `model`: the chat agent's, every task's first; `ask`: sends the agent a sentence (Ask your agent instead) about the
 *   tasks ticked, none where the chat takes none; `started`: the run went — the tasks it started, or that wait for the
 *   turn's end, and those whose launch was refused, each given back to the agent
 * @param {{ h?: Mk, dialog?: typeof dialog, menu?: typeof menu, api?: (path: string, init?: any) => Promise<any>, modelSelect?: typeof createModelSelect }} [o]
 *   the tests' fake DOM, dialog, menu, admin API and model picker
 */
export function openSideRunSheet(io, o = {}) {
  const mk = o.h || h;
  const open = o.dialog || dialog;
  const openMenu = o.menu || menu;
  const call = o.api || apiDefault;
  const pickerOf = o.modelSelect || createModelSelect;
  const route = `/sessions/${encodeURIComponent(io.chainId)}/graph/side-run`;
  /** @type {SideFacts | null} */
  let facts = null;
  /** What every task runs on and where it works, unless its own row says otherwise; `chose`: the developer picked where. */
  const all = { model: io.model, effort: "", folder: /** @type {"copy" | "yours"} */ ("copy"), chose: false };
  /** @type {SideRow[]} */
  const rows = io.ids.flatMap((id) => {
    const t = io.tasks.find((x) => x.id === id);
    return t ? [{ t, on: true, model: io.model, folder: /** @type {"copy" | "yours"} */ ("copy"), brief: null, editing: false }] : [];
  });
  let busy = false;
  let said = "";
  const body = mk("div", { class: "sr-sheet" });
  /** The pickers — every task's, and one a row opened — kept across paints. @type {Map<string, ReturnType<typeof createModelSelect>>} */
  const pickers = new Map();

  /**
   * A model picker: `pick` takes the model chosen, `back` is the one its Use the default goes back to.
   * @param {string} key @param {string} label @param {string} model @param {(name: string) => void} pick @param {() => string} back @param {string} desc
   */
  const pickerFor = (key, label, model, pick, back, desc) => {
    let p = pickers.get(key);
    if (!p) {
      const made = pickerOf({
        onChange: (name) => { pick(name || back()); paint(); },
        onUseDefault: () => { pick(back()); made.set(back()); paint(); },
        defaultDesc: desc,
        blank: back() || "Your agent's model",
      });
      made.el.setAttribute("aria-label", label);
      pickers.set(key, made);
      p = made;
    }
    p.setModels(io.models() || []);
    p.setFamilies(io.families?.() || []);
    p.setAccounts(io.accounts?.() || []);
    p.set(model);
    return p.el;
  };
  /** How hard they think, beside each picker: "" the default. @type {Map<string, ReturnType<typeof effortChip>>} */
  const chips = new Map();
  /** Every task's default: your agent's effort. */
  const AGENTS = () => ({ level: "", words: "Your agent's", desc: "As your agent thinks: the work it planned, at its effort" });
  /**
   * An effort chip: `pick` takes the level chosen ("" its default, `inherit`'s); `model` is the one beside it, whose levels
   * it offers.
   * @param {string} key @param {string} label @param {string} level @param {(level: string) => void} pick @param {() => string} model
   * @param {() => { level: string, words: string, desc: string }} [inherit]
   */
  const effortFor = (key, label, level, pick, model, inherit = AGENTS) => {
    let c = chips.get(key);
    if (!c) {
      c = effortChip({ label, value: level, onChange: (l) => { pick(l); paint(); }, model, families: () => io.families?.() || [], inherit, mk, menu: openMenu });
      chips.set(key, c);
    }
    c.set(level);
    return c.el;
  };
  /** Every task's effort: a row with one of its own keeps it. @param {string} l */
  const pickAllEffort = (l) => {
    all.effort = l;
    for (const r of rows) if (!r.ownEffort) r.effort = l;
  };
  /** Every task's model: a row with a model of its own keeps it. @param {string} m */
  const pickAll = (m) => {
    all.model = m;
    for (const r of rows) if (!r.ownModel) r.model = m;
  };
  /** Its folder can be no copy where the folder is no git repository, and one that only reads needs none. @param {SideRow} r */
  const copyable = (r) => !!r.t.writes?.length && facts?.repo !== false;
  const folderWords = (/** @type {"copy" | "yours"} */ f) => (f === "copy" ? "Its own copy" : "Your folder");
  /**
   * Where it works: its own copy or your folder, from a popup. @param {"copy" | "yours"} now @param {(f: "copy" | "yours") => void} pick
   * @param {string} title
   */
  const folderPopup = (now, pick, title) => {
    const b = mk("button", { class: "fl-popup", type: "button", title, onclick: () =>
      openMenu([
        { type: "radio", label: "Its own copy", desc: "A git worktree of your folder: your files are untouched until its change is applied", checked: now === "copy", onClick: () => { pick("copy"); paint(); } },
        { type: "radio", label: "Your folder", desc: "It edits your files as it goes, beside your agent", checked: now === "yours", onClick: () => { pick("yours"); paint(); } },
      ], { anchor: b, width: 320 }) }, mk("span", {}, folderWords(now)));
    return b;
  };
  /** Every task's folder: a row that chose its own keeps it. @param {"copy" | "yours"} f */
  const pickAllFolder = (f) => {
    all.folder = f;
    all.chose = true;
    for (const r of rows) if (!r.chose) r.folder = f;
  };
  /** A row's own folder: its own while it differs from every task's. @param {SideRow} r */
  const worksIn = (r) => {
    if (!r.t.writes?.length) return mk("span", { class: "sr-fixed" }, "Reads only — no copy needed");
    if (!copyable(r)) return mk("span", { class: "sr-fixed" }, "Your folder — not a git repository, no copy");
    return folderPopup(r.folder, (f) => { r.folder = f; r.chose = f !== all.folder; }, "Its own copy: a git worktree of your folder, applied when done. Your folder: it edits your files as it goes.");
  };
  /** What its brief says before an edit: from the task, thin, or yours. @param {SideRow} r */
  const briefNow = (r) => (r.brief ? { thin: !r.brief.goal && !r.brief.steps.trim() && !r.brief.acceptance, words: "Yours, edited" } : briefOf(r.t));
  /** What happens to it when done. @param {SideRow} r */
  const whenNow = (r) => whenDoneWords(r.t, { folder: copyable(r) ? r.folder : "yours" });
  /** Its brief: what it has, Edit opening goal, steps and done-when. @param {SideRow} r */
  const briefEl = (r) => {
    const b = briefNow(r);
    const head = mk("div", { class: "sr-brief" },
      mk("span", { class: `sr-brief-t${b.thin ? " is-thin" : ""}` }, b.words),
      mk("button", { class: "inst-link sr-link", type: "button", "aria-expanded": r.editing ? "true" : "false", onclick: () => {
        r.editing = !r.editing;
        if (r.editing && !r.brief) r.brief = { goal: String(r.t.goal || r.t.name || ""), steps: (r.t.steps || []).join("\n"), acceptance: String(r.t.acceptance || "") };
        paint();
      } }, r.editing ? "Done" : "Edit"));
    if (!r.editing || !r.brief) return head;
    const brief = r.brief;
    /** @param {"goal" | "steps" | "acceptance"} k @param {string} label @param {string} hint @param {number} lines */
    const field = (k, label, hint, lines) => {
      const el = mk("textarea", { class: "fl-input", rows: String(lines), placeholder: hint, "aria-label": `${r.t.id}: ${label}`, oninput: () => { brief[k] = String(/** @type {any} */ (el).value || ""); } });
      /** @type {any} */ (el).value = brief[k];
      return mk("label", { class: "sr-field" }, mk("span", { class: "fl-sl" }, label), el);
    };
    return mk("div", { class: "sr-brief-ed" }, head,
      field("goal", "Goal", "What must be true when it is done", 2),
      field("steps", "Steps", "What to do, in order — one a line", 3),
      field("acceptance", "Done when", "The check that proves it done", 2));
  };
  /** @param {string} label @param {...any} control */
  const line = (label, ...control) => mk("div", { class: "fl-srow" }, mk("span", { class: "fl-sl" }, label), ...kids(control));
  /** The one value every ticked row shares, or null where they differ. @param {string[]} values */
  const shared = (values) => (values.length && values.every((v) => v === values[0]) ? values[0] : null);

  /**
   * One task's row (the owner's of 10-29: six tasks drew four lines each, the same four, and the sheet ran off the
   * window): its tick, its name and what it writes, and only what differs from every task's — its model, its folder,
   * its brief, what happens when done. Change opens its own Runs on, Works in and Brief.
   * @param {SideRow} r @param {{ brief: string | null, when: string | null }} same
   */
  const rowEl = (r, same) => {
    const tick = mk("input", { type: "checkbox", class: "sr-tick", "aria-label": `Run ${r.t.id}`, ...(r.on ? { checked: "" } : {}), onchange: () => { r.on = !r.on; paint(); } });
    const files = writesWords(r.t.writes || []);
    const b = briefNow(r);
    const own = r.on
      ? [
          r.ownModel ? `on ${prettyModel(r.model)}` : "",
          r.ownEffort && r.effort ? `at ${effortName(r.effort).toLowerCase()}` : "",
          copyable(r) && r.folder !== all.folder ? (r.folder === "copy" ? "in its own copy" : "in your folder") : "",
          same.brief == null ? b.words : "",
          same.when == null ? whenNow(r) : "",
        ].filter(Boolean)
      : [];
    const sub = [files ? `writes ${files}` : "reads only", ...own];
    return mk("div", { class: `sr-row${r.on ? "" : " is-off"}${r.open && r.on ? " is-open" : ""}` },
      mk("div", { class: "sr-row-head" },
        mk("label", { class: "sr-row-pick", title: r.t.name },
          tick,
          mk("span", { class: "sr-id" }, r.t.id),
          mk("span", { class: "sr-name" }, r.t.name)),
        r.on
          ? mk("button", { class: "inst-link sr-link", type: "button", "aria-expanded": r.open ? "true" : "false", "aria-label": `${r.open ? "Done with" : "Change"} ${r.t.id}`, title: "Its own model, folder and brief", onclick: () => { r.open = !r.open; paint(); } }, r.open ? "Done" : "Change")
          : null),
      mk("p", { class: `sr-sub${b.thin && same.brief == null ? " is-thin" : ""}` }, sub.join(" · ")),
      r.on && r.open
        ? mk("div", { class: "sr-own" },
            line("Runs on", pickerFor(`row:${r.t.id}`, `${r.t.id} runs on`, r.model, (m) => { r.model = m; r.ownModel = m !== all.model; }, () => all.model, "What every task here runs on"),
              // Its default is every task's, as its model's is (the review of a8e034ded: it read as every task's and ran at
              // your agent's).
              effortFor(`row:${r.t.id}`, `How hard ${r.t.id} thinks`, r.ownEffort ? r.effort || "" : "", (l) => { r.effort = l || all.effort; r.ownEffort = !!l && l !== all.effort; }, () => r.model,
                () => ({ level: "", words: "Every task's", desc: `As every task here thinks: ${all.effort ? effortName(all.effort).toLowerCase() : "your agent's effort"}` }))),
            line("Works in", worksIn(r)),
            line("Brief", briefEl(r)))
        : null);
  };
  /**
   * Every task's choices, said once: what they run on and where they work, and their brief and what happens when done
   * where all the ticked rows share them. @param {{ brief: string | null, when: string | null, thin: boolean }} same
   */
  const allEl = (same) => {
    const writes = ticked().some((r) => !!r.t.writes?.length);
    return mk("div", { class: "sr-all", role: "group", "aria-label": "Every task" },
      mk("div", { class: "sr-all-row" },
        line("Runs on", pickerFor("all", "Every task runs on", all.model, pickAll, () => io.model, "Your agent's model: the work it planned, on its model"),
          effortFor("all", "How hard every task thinks", all.effort, pickAllEffort, () => all.model)),
        writes
          ? line("Works in", facts?.repo === false
            ? mk("span", { class: "sr-fixed" }, "Your folder — not a git repository")
            : folderPopup(all.folder, pickAllFolder, "Where every task works. Its own copy: a git worktree of your folder, applied when done. Your folder: it edits your files as it goes."))
          : null),
      ...kids([
        same.brief != null ? line("Brief", mk("span", { class: `sr-brief-t${same.thin ? " is-thin" : ""}` }, same.brief)) : null,
        same.when != null ? line("When done", mk("span", { class: "sr-when" }, same.when)) : null,
      ]));
  };
  const ticked = () => rows.filter((r) => r.on);
  function paint() {
    const on = ticked();
    const n = on.length;
    const room = facts ? roomWords(facts, n) : null;
    const mid = !!facts?.turn;
    const writers = on.filter((r) => !!r.t.writes?.length);
    const briefs = on.map((r) => briefNow(r));
    const same = { brief: shared(briefs.map((b) => b.words)), when: shared(on.map(whenNow)), thin: briefs.some((b) => b.thin) };
    body.replaceChildren(...kids([
      mk("p", { class: "sr-lede" }, "Each task goes to a sub-agent of its own. Your agent is told to leave them to them."),
      allEl(same),
      mk("div", { class: "sr-list", role: "group", "aria-label": "The tasks" }, ...rows.map((r) => rowEl(r, same))),
      mk("div", { class: "sr-foot" }, ...kids([
        mk("p", { class: `sr-room${room && !room.fits ? " is-warn" : ""}` }, room ? room.words : "Reading the room this chat has…"),
        // Mid-turn, what a copy is made of: a sub-agent's change is its own against its copy, so it applies over whatever
        // the agent edits meanwhile. One in your folder writes beside the agent, in the files it may be editing now (the
        // review of side-now).
        mid && writers.some((r) => r.folder === "copy") ? mk("p", { class: "sr-room" }, "Your agent is still working: each copy is your folder as it stands, its edits so far included.") : null,
        mid && writers.some((r) => r.folder === "yours") ? mk("p", { class: "sr-room is-warn" }, YOURS_MID_WORDS + (facts?.repo === false ? "" : " Its own copy keeps them apart.")) : null,
        said ? mk("p", { class: "fl-note is-warn" }, said) : null,
        mk("div", { class: "fl-sheet-foot" }, ...kids([
          io.ask ? mk("button", { class: "inst-link sr-link", type: "button", title: `Sends your agent: “${askSentence(on.map((r) => r.t.id))}”`, onclick: () => { const ids = ticked().map((r) => r.t.id); io.ask?.(askSentence(ids), ids); d.close(true); } }, "Ask your agent to run them instead") : null,
          mk("span", { class: "th-sp" }),
          mk("button", { class: "inst-btn", type: "button", onclick: () => d.close(true) }, "Cancel"),
          mk("button", { class: "inst-btn is-primary", type: "button", ...(!n || !room?.fits || busy ? { disabled: "" } : {}), onclick: () => void run() }, busy ? "Starting…" : `Run ${n} ${n === 1 ? "task" : "tasks"}`),
        ])),
      ])),
    ]));
  }
  const run = async () => {
    const n = ticked().length;
    if (busy || !n) return;
    busy = true;
    said = "";
    paint();
    try {
      const r = await call(route, { method: "POST", body: sideBody(rows, { starts: "now" }) });
      d.close(true);
      // What the run did, not what was ticked (the Hunter's of 10-28): a launch refused gave its task back.
      const later = !!r?.later;
      io.started?.({ ids: later || !Array.isArray(r?.started) ? ticked().map((x) => x.t.id) : r.started, later, refused: Array.isArray(r?.refused) ? r.refused : [] });
    } catch (/** @type {any} */ e) {
      said = `Nothing started: ${String(e?.message || e)}`;
      busy = false;
      paint();
    }
  };
  const d = open({ title: `Run ${rows.length} ${rows.length === 1 ? "task" : "tasks"} in parallel`, body, wide: true, cls: "sr-dialog" });
  paint();
  call(route)
    .then((/** @type {SideFacts} */ f) => {
      facts = f;
      // A choice made while the room was read stands (the Hunter's of 10-28) — where a copy can be made at all.
      if (!all.chose || !f.repo) all.folder = f.worktree && f.repo ? "copy" : "yours";
      for (const r of rows) if (!r.chose || !f.repo) r.folder = f.repo ? all.folder : "yours";
      paint();
    })
    .catch((/** @type {any} */ e) => {
      said = `The chat's room could not be read: ${String(e?.message || e)}`;
      paint();
    });
  return { close: () => d.close(true) };
}
