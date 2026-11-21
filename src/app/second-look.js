// @ts-check
// A second look's run (HarnessV4_Space_Plan S3b, SG-D12): the Reviewer — the saved agent, read-only — reads a move before
// the person answers it, as an agent of a chat: the one that asks, or the one that made the dashboard version a button
// belongs to. It goes through the registry every agent goes through, as an agent that starts by itself does
// (`origin: "self"`): it takes no seat, leaves no row in the chat's transcript, and its answer stays with the person,
// never sent to the chat's agent. `start` launches it — on the model the person chose, where they chose one (a
// dashboard's button, the owner's word of 10-31), else as its card and its chat say —; `run` waits — no clock: its
// launch goes on until its run exists or it ended without one — and answers its run, which the page follows for the
// words as they come, with what runs it and what it was asked; `stop` stops it.
// A check (S5d, SG-D25) is the same Reviewer, launched by `check` once a dashboard's button ran: it reads whether the
// button did what it was for; `ended` waits — no clock — for how it ended and its report, whose Verdict line the
// dashboards' runner writes in What happened.
import { checkWords, lookWords } from "../core/second-look.js";

/** The saved agent a second look runs as. */
export const REVIEWER = "reviewer";

/**
 * @typedef {import("../core/second-look.js").LookRef} LookRef
 * @typedef {import("../core/second-look.js").LookAbout} LookAbout
 */

/**
 * Why a second look could not start, as the card says it: "No second look: …".
 * @param {string} error  the registry's words
 */
const noLook = (error) => String(error || "it could not start").replace(/\.$/, "");

/**
 * @param {object} d
 * @param {() => Pick<import("./agent/subagents.js").SubagentRegistry, "launch" | "get" | "detail" | "stop"> | null} d.registry
 * @param {import("../core/ports.js").EventBus} d.events
 * @param {(chainId: string) => { title: string } | null} d.chatOf  a chat that is there to run it in, or null
 * @param {(level: string, msg: string) => void} [d.log]
 */
export function createSecondLook({ registry, events, chatOf, log = () => {} }) {
  /**
   * The Reviewer starts on a move, in a chat. `model`: the one the person chose; none, its card's or its chat's.
   * @param {{ chainId: string, cwd?: string, about: LookAbout, why: string, description?: string, model?: string }} o
   * @returns {{ ok: true, chain: string, agent: string } | { ok: false, error: string }}
   */
  function start({ chainId, cwd = "", about, why, description = "Second look", model = "" }) {
    return launch({ chainId, cwd, prompt: lookWords(about), why, description, what: "second look", model });
  }

  /**
   * A check (HarnessV4_Space_Plan S5d): the Reviewer, read-only, after a dashboard's button ran and ended done — the same
   * agent as a second look, its task whether the button did what it was for, on the model the person chose.
   * @param {{ chainId: string, cwd?: string, about: import("../core/second-look.js").CheckAbout, why: string, description?: string, model?: string }} o
   * @returns {{ ok: true, chain: string, agent: string } | { ok: false, error: string }}
   */
  function check({ chainId, cwd = "", about, why, description = "Check", model = "" }) {
    return launch({ chainId, cwd, prompt: checkWords(about), why, description, what: "check", model });
  }

  /**
   * @param {{ chainId: string, cwd: string, prompt: string, why: string, description: string, what: string, model: string }} o
   * @returns {{ ok: true, chain: string, agent: string } | { ok: false, error: string }}
   */
  function launch({ chainId, cwd, prompt, why, description, what, model }) {
    const reg = registry();
    if (!reg) return { ok: false, error: "agents are not available in this Filament" };
    const chain = String(chainId || "");
    if (!chain || !chatOf(chain)) return { ok: false, error: "the chat it would run in is gone" };
    const on = String(model || "").trim();
    const r = reg.launch({ origin: "self", second: true, chainId: chain, as: REVIEWER, may: "read", prompt, description, why, ...(cwd ? { cwd } : {}), ...(on ? { model: on } : {}) });
    if (!r.ok) {
      log("info", `${what}: the Reviewer did not start in ${chain} (${r.error})`);
      return { ok: false, error: noLook(r.error) };
    }
    log("info", `${what}: the Reviewer started in ${chain} as ${r.id} — ${why}`);
    return { ok: true, chain, agent: r.id };
  }

  /**
   * A second look or a check, once it ended — no clock: its answer, or why it has none (stopped, failed, no longer
   * kept). `status` is the registry's.
   * @param {string} chainId @param {string} agentId
   * @returns {Promise<{ status: string, report: string, error: string | null }>}
   */
  function ended(chainId, agentId) {
    const reg = registry();
    if (!reg) return Promise.resolve({ status: "gone", report: "", error: "agents are not available in this Filament" });
    /** @returns {{ status: string, report: string, error: string | null } | null} */
    const now = () => {
      const sa = reg.get(agentId);
      if (!sa || sa.chainId !== chainId || !sa.second) return { status: "gone", report: "", error: "it is no longer kept" };
      if (sa.status === "running") return null;
      const last = sa.exchanges.at(-1);
      return { status: sa.status, report: String(last?.report || ""), error: last?.error || null };
    };
    const first = now();
    if (first) return Promise.resolve(first);
    return new Promise((resolve) => {
      // Its end is said as every change of its state is (`subagent`, the registry's `changed`); its progress, twice a
      // second while it runs, changes nothing read here, and each read builds its whole public form.
      const off = events.subscribe("subagents", (p) => {
        if (p?.type !== "subagent" || p.id !== agentId) return;
        const got = now();
        if (!got) return;
        off();
        resolve(got);
      });
      const late = now();
      if (late) {
        off();
        resolve(late);
      }
    });
  }

  /**
   * A second look's run, once there is one: its id, whether it still runs, and — ended — its answer or why it failed;
   * with what runs it — its model and that model's provider — and its task whole, as it was asked (the owner's word of
   * 10-31: an agent says what it runs on and how it was made), secrets hidden.
   * @param {string} chainId @param {string} agentId
   * @returns {Promise<{ ok: true, runId: string | null, status: string, report: string, error: string | null, model: string, provider: string | null, asked: string } | { ok: false, error: string }>}
   */
  async function run(chainId, agentId) {
    const reg = registry();
    if (!reg) return { ok: false, error: "agents are not available in this Filament" };
    /** @returns {{ ok: true, runId: string | null, status: string, report: string, error: string | null } | { ok: false, error: string } | null} */
    const now = () => {
      const sa = reg.get(agentId);
      if (!sa || sa.chainId !== chainId || !sa.second) return { ok: false, error: "that second look is no longer kept" };
      const last = sa.exchanges.at(-1);
      const ended = sa.status !== "running";
      if (!sa.runId && !ended) return null;
      return { ok: true, runId: sa.runId, status: sa.status, report: ended ? String(last?.report || "") : "", error: ended ? last?.error || null : null };
    };
    /**
     * Its answer, with what runs it and its task: read once, as it is answered — its whole form is no read for each
     * change of its state. @param {NonNullable<ReturnType<typeof now>>} got
     */
    const told = (got) => {
      if (!got.ok) return got;
      const sa = reg.get(agentId);
      return { ...got, model: String(sa?.model || ""), provider: sa?.provider ?? null, asked: String(reg.detail(agentId)?.exchanges[0]?.prompt || "") };
    };
    const first = now();
    if (first) return told(first);
    // Its run is minted as its first model call goes out: the registry says so on the bus (`subagent`, as its end).
    return new Promise((resolve) => {
      const off = events.subscribe("subagents", (p) => {
        if (p?.type !== "subagent" || p.id !== agentId) return;
        const got = now();
        if (!got) return;
        off();
        resolve(told(got));
      });
      // It may have attached between the read above and the subscription.
      const late = now();
      if (late) {
        off();
        resolve(told(late));
      }
    });
  }

  /** @param {string} chainId @param {string} agentId */
  function stop(chainId, agentId) {
    const reg = registry();
    const sa = reg?.get(agentId) || null;
    if (!reg || !sa || sa.chainId !== chainId || !sa.second) return { ok: false, error: "that second look is no longer kept" };
    if (sa.status !== "running") return { ok: true, ran: false };
    const r = reg.stop(agentId, { from: "filament" });
    return r.ok ? { ok: true, ran: true } : { ok: false, error: r.error };
  }

  return { start, check, run, stop, ended };
}

/** @typedef {ReturnType<typeof createSecondLook>} SecondLook */

/**
 * A chat's second looks, as a turn's gate asks for them — the loop's (`secondLook`) and a coding agent's permits
 * (`look`): the Reviewer starts in that chat, in the folder the move runs in, and stops once its call is answered.
 * @param {SecondLook} looks @param {string} chainId
 * @returns {{ start: (about: LookAbout) => LookRef, stop: (look: LookRef) => void }}
 */
export const lookIn = (looks, chainId) => ({
  start: (about) => {
    const r = looks.start({ chainId, cwd: about.folder, about, why: about.why });
    return r.ok ? { chain: r.chain, agent: r.agent } : { error: r.error };
  },
  stop: (look) => {
    if ("agent" in look) looks.stop(look.chain, look.agent);
  },
});
