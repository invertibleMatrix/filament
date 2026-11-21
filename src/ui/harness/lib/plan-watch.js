// @ts-check
// What a chat's task graph did since the page last looked (the owner's of 11-04: "the goal is to give some live feedback
// about task completion"): the graph the Plan page shows, read at each of the views' pulses (views/host.js), told as two
// things. `first`: the chat's first graph appeared, while the page watched — the right bar opens on it. `done`: its
// tasks done since the last look — the Plan in sight marks them, else a peek shows them (views/plan-peek.js). The
// checklist is none of it (the owner's of 11-04: "Todo taska are already shown into the transcript, i think it's just
// the task graph ones"): its own page tells nothing, a graph of its tasks alone is no first, and a task its item ticked
// done is not told — the conversation showed the tick. A task it names that a worker or the agent's tasks call ends is
// told: no tick says so. A chat's first look is its baseline: a reload, or a chat opened, tells nothing of what was done
// before it. The chats whose graph was shown are kept by this browser, so a reload never opens the bar again.

/**
 * @typedef {{ key: string, name: string, done: boolean, ticked: boolean }} PlanItem  a task, by its id; `ticked`: its
 *   checklist item ended it (core/task-graph.js `graphView`)
 */
/**
 * @typedef {{ items: PlanItem[], own: number, done: number, all: number, fresh?: boolean }} PlanFacts  `own`: the tasks
 *   the checklist did not put there; `done` of `all`: how much of the graph is done, as its head counts it; `fresh`: the
 *   running turn moved the graph, not by its checklist (plan.js `planNow`)
 */

/**
 * The graph the page shows, as the feedback reads it: its tasks, the dropped left out; none where the page shows the
 * checklist, or nothing.
 * @param {{ graph: any }} d  plan.js `planOf`'s @param {"graph" | "checklist" | ""} shows  plan.js `pageOf`'s
 * @returns {PlanFacts}
 */
export function planFacts(d, shows) {
  /** @type {any[]} */
  const tasks = (shows === "graph" ? d.graph?.tasks || [] : []).filter((/** @type {any} */ t) => t.state !== "dropped");
  return {
    items: tasks.map((t) => ({ key: String(t.id), name: String(t.name || t.id), done: t.state === "done", ticked: !!t.ticked })),
    own: tasks.filter((t) => !t.checklist).length,
    done: tasks.filter((t) => t.state === "done").length,
    all: tasks.length,
  };
}

const KEY = "harness.planShown";
/** The newest chats kept; an older one's first graph is long behind it. */
const MOST = 300;

/** @typedef {{ get: () => string[], set: (chains: string[]) => void }} ShownStore */

/** This browser's list. @type {ShownStore} */
const local = {
  get: () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  },
  set: (chains) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(chains));
    } catch {}
  },
};

/**
 * The watch: `see` takes each look at a chat's graph, once the page can say it (plan.js `planNow`), and answers what to
 * tell. `first` where tasks of its own appear in a chat whose graph was never shown — the chat looked at before without
 * them, or the running turn made them (`live`), so a session the page opens with an old graph stays as it is. `done` the
 * ids of the tasks the last look saw not done, and are done now, by no tick. `forget` makes a chat's next look its
 * baseline again: shown again after another chat, it tells nothing of what was done meanwhile. `store` is the tests'
 * seam.
 * @param {{ store?: ShownStore }} [o]
 */
export function createPlanWatch(o = {}) {
  const store = o.store || local;
  /** chain → what its last look saw @type {Map<string, PlanFacts>} */
  const last = new Map();
  /** @type {string[] | null} */
  let shown = null;
  const shownNow = () => (shown ||= store.get());
  return {
    /**
     * @param {string} chain @param {PlanFacts} facts @param {{ live?: boolean }} [o2]
     * @returns {{ first: boolean, done: string[] }}
     */
    see(chain, facts, o2 = {}) {
      const before = last.get(chain) || null;
      last.set(chain, facts);
      let first = false;
      if (facts.own && !shownNow().includes(chain)) {
        first = !!before || !!o2.live;
        shown = [...shownNow(), chain].slice(-MOST);
        store.set(shown);
      }
      if (!before) return { first, done: [] };
      const was = new Map(before.items.map((i) => [i.key, i.done]));
      return { first, done: facts.items.filter((i) => i.done && !i.ticked && was.get(i.key) === false).map((i) => i.key) };
    },
    /** @param {string} chain */
    forget(chain) {
      last.delete(chain);
    },
  };
}
