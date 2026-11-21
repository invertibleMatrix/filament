// @ts-check
// The Team view's seams on the fake DOM (HarnessV3-Views V3): a TeamIO that records what the view asks of its host —
// the session's task graph it reads, none unless a test gives one (HarnessV3-TaskGraph G3-7) — and a model picker that
// draws nothing and keeps what it was told to show.
import { fakeH, textOf } from "./fake-dom.js";
import { poolRows } from "../../src/ui/harness/lib/pool.js";

/** The clock the recording TeamIO reads. */
export const NOW = 1_800_000_000_000;

/**
 * A TeamIO that records each write, open, stop, send-back, answer, switch, task opened on the graph and New team; any part is the
 * test's to replace.
 * @param {Record<string, any>} [over]
 */
export function teamIO(over = {}) {
  /** @type {any[][]} */
  const calls = [];
  return {
    calls,
    rows: () => /** @type {any[]} */ ([]),
    own: () => /** @type {any[]} */ ([]),
    face: () => ({ fill: /** @type {number | null} */ (null), color: "", text: "" }),
    model: () => "glm-5.3",
    models: () => /** @type {any[]} */ ([]),
    /** @param {string} model */
    account: (model) => /** @type {any} */ (null),
    /** @param {any} change */
    write: (change) => { calls.push(["write", change]); },
    /** @param {string} id */
    open: (id) => { calls.push(["open", id]); },
    /** @param {string} id */
    stop: (id) => { calls.push(["stop", id]); },
    /** @param {string} task @param {boolean} fresh */
    sendBack: (task, fresh) => { calls.push(["sendBack", task, fresh]); },
    /** @param {string} id @param {any} words */
    answer: async (id, words) => { calls.push(["answer", id, words]); return true; },
    /** @param {string} id @param {any} offer */
    always: async (id, offer) => { calls.push(["always", id, offer]); return true; },
    /** @param {any} team */
    lead: (team) => { calls.push(["lead", team.key]); },
    back: () => { calls.push(["back"]); },
    graph: () => /** @type {any} */ (null),
    /** @param {string} id */
    openTask: (id) => { calls.push(["openTask", id]); },
    newTeam: () => { calls.push(["newTeam"]); },
    now: () => NOW,
    ...over,
  };
}

/**
 * Pool chips that keep what they show (HarnessV4_Tasks E15 step 8): `make` is a view's `poolChip`, `made` the chips
 * it made — each with what its view handed it (`io`: the rows, the callbacks) and, at each paint, the rows and the
 * main agent's model it would draw (`shown`). As the real chip, one reads nothing until its view paints it.
 */
/**
 * The quiet line under the Who runs on what row a chip stands in: its part and whose list it is.
 * @param {any} root @param {{ el: any }} chip @returns {string | null}
 */
export function runsOnSubOf(root, chip) {
  /** @param {any} n @returns {any[]} */
  const walk = (n) => (Array.isArray(n?.kids) ? n.kids : []).flatMap((/** @type {any} */ k) => (k && typeof k === "object" ? [k, ...walk(k)] : []));
  const r = walk(root).find((n) => String(n.attrs?.class || "").includes("runs-on-row") && n.kids.includes(chip.el));
  return r ? textOf(r.querySelector(".inst-row-sub")) : null;
}

export function poolChips() {
  /** @type {any[]} */
  const made = [];
  /** @param {any} io */
  const make = (io) => {
    const chip = {
      io,
      el: fakeH("span", { class: "pool-chip" }),
      shown: /** @type {{ rows: any[], main: string } | null} */ (null),
      paint() { chip.shown = { rows: poolRows(io.rows()), main: String(io.main?.() || "") }; },
      open() {},
    };
    made.push(chip);
    return chip;
  };
  return { make, made };
}

/** Model pickers that keep what they show: `make` is the view's `modelSelect`, `made` the pickers it made. */
export function modelSelects() {
  /** @type {any[]} */
  const made = [];
  /** @param {any} o  the view's callbacks: `onChange`, `onUseDefault` */
  const make = (o) => {
    const chip = {
      o,
      el: fakeH("span", { class: "model-select" }),
      models: /** @type {any[]} */ ([]),
      families: /** @type {any[]} */ ([]),
      accounts: /** @type {any[]} */ ([]),
      name: "",
      note: /** @type {string | null} */ (null),
      /** @param {any[]} m */
      setModels(m) { chip.models = m; },
      /** @param {any[]} f */
      setFamilies(f) { chip.families = f; },
      /** @param {any[]} a */
      setAccounts(a) { chip.accounts = a; },
      /** @param {string} name */
      set(name) { chip.name = name; },
      /** @param {string | null} n */
      setNote(n) { chip.note = n; },
    };
    made.push(chip);
    return chip;
  };
  return { make, made };
}
