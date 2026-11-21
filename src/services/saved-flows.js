// @ts-check
// Saved flows (HarnessV4_Flow_Plan F6; HarnessV4_OneAgent_Plan OA3): a drawn flow's steps and boxes kept to start
// again from Agents › New flow — each step's why, each box's id and what it needs with it — without the words it was
// drawn from: those are the person's each time. One ships: Plan, check, build, hunt — the owner's example of 10-21 as
// its steps. Kept in Filament's data folder, `flows-saved.json`; without a folder (tests), in memory alone.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOX_KINDS, FLOW_LIMITS, boxSeesOf, lineOf } from "../core/flow.js";
import { SUBAGENT_EFFORTS } from "../core/schema.js";

/**
 * @typedef {{ id?: string, kind: string, agent: string, words: string, needs?: string[], gate?: boolean, readOnly?: boolean, model?: string | null,
 *   effort?: string, sees?: string | null }} SavedBox  `needs`: the ids of the boxes whose results it is handed; none kept, the step before's
 */
/** @typedef {{ key: string, name: string, steps: { why?: string, boxes: SavedBox[] }[], shipped: boolean, at?: number }} SavedFlow */

/**
 * The flow that ships (F6): the owner's example — plan, an architecture and mocks, a check before building, the build,
 * a hunt. Its boxes are agents of their own, never a team's own Lead (HarnessV4_OneAgent_Plan OA-D4): Product plans and
 * draws the screens, a Builder the architecture, the Reviewer is the gate. Each box needs what it reads (OA-D5): the hunt
 * reads the build alone.
 */
export const SHIPPED_FLOWS = Object.freeze({
  "plan-check-build-hunt": {
    name: "Plan, check, build, hunt",
    steps: [
      {
        why: "The plan comes first: everything after it builds on it.",
        boxes: [{ id: "plan", kind: "agent", agent: "product", needs: [], words: "Plan it: what to build first, the smallest version worth having, what to leave out, and what would show it worked." }],
      },
      {
        why: "The architecture and the screens each need only the plan, so they run side by side.",
        boxes: [
          { id: "arch", kind: "agent", agent: "builder", needs: ["plan"], words: "An architecture for the plan: the modules, their interfaces and how data flows between them, against the code as it is." },
          { id: "mocks", kind: "agent", agent: "product", needs: ["plan"], words: "Where it lives on the page and in which words; publish mocks of the screens as artifacts where they help." },
        ],
      },
      {
        why: "Nothing is built until the plan, the architecture and the mocks hold together: the Reviewer's not yet holds the flow for your word.",
        boxes: [{ id: "check", kind: "agent", agent: "reviewer", gate: true, needs: ["plan", "arch", "mocks"], words: "Check the plan, the architecture and the mocks before anything is built: what does not hold against the code, what is missing, what contradicts what." }],
      },
      {
        why: "The build reads everything before it, the check included.",
        boxes: [{ id: "build", kind: "team", agent: "builders", needs: ["plan", "arch", "mocks", "check"], words: "Build it, following the plan, the architecture and the mocks handed to you." }],
      },
      {
        why: "The hunt reads what was built.",
        boxes: [{ id: "hunt", kind: "team", agent: "bughunters", needs: ["build"], words: "Hunt for bugs in what the step before built." }],
      },
    ],
  },
});

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/** A saved flow's key from its name. @param {unknown} name */
const keyOf = (name) =>
  String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

/** A box's id or a need as kept: lower-cased, at most 24 characters. @param {unknown} v */
const idOf = (v) => String(v ?? "").trim().toLowerCase().slice(0, 24);

/**
 * Its steps as they are kept: each step's why; each box's id, kind, agent, words, needs and switches, nothing of a run.
 * @param {any} steps @returns {{ why: string, boxes: SavedBox[] }[]}
 */
function stepsOf(steps) {
  if (!Array.isArray(steps) || !steps.length) throw refused(400, "a saved flow keeps its steps: draw at least one");
  if (steps.length > FLOW_LIMITS.steps) throw refused(400, `a flow has ${FLOW_LIMITS.steps} steps at most`);
  return steps.map((/** @type {any} */ s) => ({
    why: lineOf(s?.why, FLOW_LIMITS.why),
    boxes: (Array.isArray(s?.boxes) ? s.boxes : []).slice(0, FLOW_LIMITS.boxes).map((/** @type {any} */ b) => ({
      ...(idOf(b?.id) ? { id: idOf(b.id) } : {}),
      kind: BOX_KINDS.includes(b?.kind) ? String(b.kind) : "agent",
      agent: String(b?.agent ?? "").trim().toLowerCase(),
      words: String(b?.words ?? "").trim().slice(0, FLOW_LIMITS.words),
      ...(Array.isArray(b?.needs) ? { needs: [...new Set(b.needs.map(idOf).filter(Boolean))].slice(0, FLOW_LIMITS.needs) } : {}),
      gate: b?.gate === true,
      readOnly: b?.readOnly === true,
      model: typeof b?.model === "string" && b.model.trim() ? b.model.trim() : null,
      // How hard it thinks, where one is picked (the review of a8e034ded: a saved flow dropped it); a review has none.
      ...(b?.kind !== "review" && SUBAGENT_EFFORTS.includes(b?.effort) ? { effort: String(b.effort) } : {}),
      sees: boxSeesOf(BOX_KINDS.includes(b?.kind) ? String(b.kind) : "agent", b?.sees),
    })),
  }));
}

/** @param {{ dataDir: string | null, log?: (level: string, msg: string) => void, now?: () => number }} o */
export function createSavedFlows({ dataDir, log = () => {}, now = Date.now }) {
  const file = dataDir ? join(dataDir, "flows-saved.json") : null;
  /** @type {Map<string, SavedFlow>} */
  const own = new Map();
  if (file)
    try {
      const j = JSON.parse(readFileSync(file, "utf8"));
      for (const [key, f] of Object.entries(j?.flows || {})) {
        try {
          own.set(key, { key, name: lineOf(/** @type {any} */ (f).name, 80) || key, steps: stepsOf(/** @type {any} */ (f).steps), shipped: false, at: Number(/** @type {any} */ (f).at) || 0 });
        } catch {
          log("warn", `flows: the saved flow ${key} does not read as one; it is left out`);
        }
      }
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT") log("warn", `flows: the saved flows could not be read (${e?.message || e})`);
    }
  const write = () => {
    if (!file) return;
    const flows = Object.fromEntries([...own.values()].map((f) => [f.key, { name: f.name, steps: f.steps, at: f.at }]));
    writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, flows }));
    renameSync(`${file}.tmp`, file);
  };
  /** @returns {SavedFlow[]} */
  const shipped = () => Object.entries(SHIPPED_FLOWS).map(([key, f]) => ({ key, name: f.name, steps: structuredClone(/** @type {any} */ (f.steps)), shipped: true }));
  return {
    /** Every saved flow: the shipped one first, then the person's by name. */
    list: () => [...shipped(), ...[...own.values()].sort((a, b) => a.name.localeCompare(b.name)).map((f) => structuredClone(f))],
    /** @param {unknown} key @returns {SavedFlow | null} */
    find: (key) => {
      const k = String(key ?? "");
      return shipped().find((f) => f.key === k) || (own.has(k) ? structuredClone(/** @type {SavedFlow} */ (own.get(k))) : null);
    },
    /** A flow kept under its name; one of the same name is kept over. @param {{ name?: unknown, steps?: unknown }} input */
    save(input) {
      const name = lineOf(input?.name, 80);
      const key = keyOf(name);
      if (!key) throw refused(400, "name the saved flow");
      if (Object.hasOwn(SHIPPED_FLOWS, key)) throw refused(403, `${name} is the flow that ships: name yours another way`);
      const f = { key, name, steps: stepsOf(input?.steps), shipped: false, at: now() };
      own.set(key, f);
      write();
      return structuredClone(f);
    },
    /** @param {unknown} key */
    remove(key) {
      const k = String(key ?? "");
      if (Object.hasOwn(SHIPPED_FLOWS, k)) throw refused(403, "the flow that ships stays");
      if (!own.delete(k)) throw refused(404, `no saved flow answers to "${k}"`);
      write();
      return { ok: true };
    },
  };
}

/** @typedef {ReturnType<typeof createSavedFlows>} SavedFlows */
