// @ts-check
// Set up a machine over SSH (the remote desk's s3b): the sheet of This computer's page in the desktop app where an SSH
// host of yours — user@host, or a Host of your SSH config — becomes a machine of this window, Filament installed there,
// run as a service (systemd's; a Windows host's Task Scheduler), its coding agents connected and memory on, reached over
// https and paired. The app makes each step
// (desktop/lib/setup-over-ssh.js, through its bridge's `sshSetup`), one after another, the sheet saying each as it goes;
// a step that failed is tried again alone (Retry), and one the person must answer — a host key ssh does not know — runs
// ssh in a terminal on the sheet (Filament's own terminal running that program, POST /terminal), the step asked again
// once it ends well. What only the person may run there — sudo's lines: lingering, Tailscale's operator, the firewall —
// is said under its step, with its line to copy and Run in a terminal. Run again on a machine set up already, every step
// says it had nothing to do. Built with an injected `h`, bridge, `api`, sheet and terminal view, so it runs on the fake
// DOM; its steps' order apart from the page (`setupFlow`).
import { h } from "../lib/dom.js";
import { api } from "./lib/api.js";
import { ICONS } from "./lib/icons.js";
import { taskSheetParts } from "./lib/task-sheet.js";
import { sheet } from "./lib/ui.js";
import { showTerminal } from "./lib/xterm.js";

/** The steps, in the app's order (desktop/lib/setup-over-ssh.js `STEPS`). */
export const SETUP_STEPS = Object.freeze([
  { id: "reach", title: "Reach it over SSH" },
  { id: "install", title: "Install Filament" },
  { id: "service", title: "Run it as a service" },
  { id: "setup", title: "Its coding agents and memory" },
  { id: "route", title: "A way in over https" },
  { id: "pair", title: "Pair this window with it" },
]);

/**
 * @typedef {{ title: string, file: string, args: string[], line: string | null }} StepTerminal
 * @typedef {{ words: string, line: string, terminal: StepTerminal | null }} StepLine
 * @typedef {{ step: string, state: "done" | "skipped" | "failed" | "ask", words: string, terminal?: StepTerminal,
 *   also?: StepLine[], offer?: { label: string, latest: true }, machine?: { id: string, name: string } }} StepResult
 * @typedef {{ id: string, title: string, state: "pending" | "running" | "done" | "skipped" | "failed" | "ask", words: string,
 *   also: StepLine[], offer: { label: string, latest: true } | null }} StepRow
 * @typedef {{ alias: string, rows: StepRow[], running: boolean, term: { id: string, why: string, line: string | null } | null,
 *   machine: { id: string, name: string } | null, ended: "" | "set" | "nothing" }} SetupView
 *   `term`: the terminal on the sheet, and why; `ended`: every step went — set up now, or with nothing to do
 */

/**
 * The setup's steps apart from the page: each asked of the app in its order, stopping at one that failed; a terminal
 * opened where a step asks the person (`ask`), the step asked again once it ends with code 0; Retry, the offer of a
 * step, and an also-line's terminal each ask their step again.
 * @param {{ run: (input: { alias: string, step: string, latest?: boolean }) => Promise<StepResult | null>,
 *   open: (t: StepTerminal) => Promise<string>, kill: (id: string) => void }} io
 *   `open`: a terminal running the program, → its id; `kill`: one stopped
 * @param {(v: SetupView) => void} paint
 */
export function setupFlow(io, paint) {
  /** @type {SetupView} */
  const v = { alias: "", rows: [], running: false, term: null, machine: null, ended: "" };
  /** The terminal waited on: its end goes on with its step. @type {{ id: string, done: (code: number | null) => void } | null} */
  let waiting = null;
  /** A sheet closed, or started over: what the last run answers is no longer shown. */
  let gen = 0;
  const fresh = () => SETUP_STEPS.map((s) => ({ id: s.id, title: s.title, state: /** @type {const} */ ("pending"), words: "", also: [], offer: null }));
  const show = () => paint({ ...v, rows: v.rows.map((r) => ({ ...r })) });

  /**
   * A terminal running `t`, its id said on the sheet, waited on until it ends. → its exit code, or the words where none
   * could open. @param {StepTerminal} t @param {string} why
   */
  const inTerminal = async (t, why) => {
    /** @type {string} */
    let id;
    try {
      id = await io.open(t);
    } catch (/** @type {any} */ e) {
      return { words: `No terminal opened here (${String(e?.message || e)})${t.line ? `: run ${t.line} in one of your own, then Retry.` : "."}` };
    }
    v.term = { id, why, line: t.line };
    show();
    const code = await new Promise((/** @type {(c: number | null) => void} */ done) => (waiting = { id, done }));
    waiting = null;
    return { code };
  };

  /**
   * The steps from `from` on, each asked in turn — `one`: that step alone —, stopping at one that failed or one the
   * person did not answer. @param {number} from @param {{ latest?: boolean, one?: boolean }} [o]
   */
  async function go(from, { latest = false, one = false } = {}) {
    if (v.running || !v.alias) return;
    const g = gen;
    v.running = true;
    v.ended = "";
    for (let i = from; i < v.rows.length; ) {
      const row = v.rows[i];
      row.state = "running";
      row.words = "";
      row.also = [];
      row.offer = null;
      show();
      /** @type {StepResult | null} */
      let r = null;
      try {
        r = await io.run({ alias: v.alias, step: row.id, ...(latest && row.id === "install" ? { latest: true } : {}) });
      } catch (/** @type {any} */ e) {
        r = { step: row.id, state: "failed", words: String(e?.message || e) };
      }
      if (g !== gen) return;
      if (!r) r = { step: row.id, state: "failed", words: "The app did not answer: set a machine up from Filament's app." };
      Object.assign(row, { state: r.state, words: String(r.words || ""), also: Array.isArray(r.also) ? r.also : [], offer: r.offer ?? null });
      if (r.machine) v.machine = r.machine;
      if (r.state === "ask" && r.terminal) {
        show();
        const t = await inTerminal(r.terminal, row.words);
        if (g !== gen) return;
        v.term = null;
        if ("code" in t && t.code === 0) continue;
        Object.assign(row, { state: "failed", words: "words" in t ? t.words : `The terminal ended${t.code == null ? "" : ` with code ${t.code}`} before it was answered: Retry asks again.` });
      }
      // An ask with no terminal to answer it in goes no further than a failure does.
      const now = /** @type {StepRow["state"]} */ (row.state);
      if (now === "failed" || now === "ask") {
        row.state = "failed";
        v.running = false;
        return show();
      }
      if (one) break;
      i++;
    }
    v.running = false;
    // Nothing to do where no step did a thing, nor left a line only the person may run (sudo's lingering, say).
    if (v.rows.every((r) => r.state === "done" || r.state === "skipped")) v.ended = v.rows.slice(1).every((r) => r.state === "skipped" && !r.also.length) ? "nothing" : "set";
    show();
  }

  return {
    /** The sheet as it stands. */
    view: () => v,
    /** Set it up: every step, from the first, for the host typed. @param {string} alias */
    start(alias) {
      if (v.running) return Promise.resolve();
      v.alias = String(alias || "").trim().replace(/^ssh:\/\//i, "");
      v.rows = fresh();
      v.machine = null;
      v.ended = "";
      if (!v.alias) {
        show();
        return Promise.resolve();
      }
      return go(0);
    },
    /** A failed step tried again, and those after it. @param {number} i */
    retry: (i) => go(i),
    /** A step's offer taken: it asked again so, and those after it. @param {number} i */
    take: (i) => go(i, { latest: !!v.rows[i]?.offer?.latest }),
    /**
     * An also-line run in a terminal: once it ends well, its step asked again — alone, to say what stands now; a failed
     * one's, with the steps after it. @param {number} i @param {number} j
     */
    async runLine(i, j) {
      const line = v.rows[i]?.also[j];
      if (v.running || !line?.terminal) return;
      const g = gen;
      v.running = true;
      const t = await inTerminal(line.terminal, line.words);
      if (g !== gen) return;
      v.term = null;
      v.running = false;
      if ("words" in t) {
        v.rows[i].words = `${v.rows[i].words} ${t.words}`.trim();
        return show();
      }
      // A failed step's line (this computer's key added) goes on with the steps after it; a done one's (sudo's) says
      // what stands now.
      if (t.code === 0) return go(i, { one: v.rows[i].state !== "failed" });
      show();
    },
    /** The terminal on the sheet ended: with its code, where its stream said one. @param {string} id @param {number | null} code */
    terminalEnded(id, code) {
      if (waiting?.id === id) waiting.done(code);
    },
    /** The sheet closed: a terminal it opened is stopped, and nothing answered later is shown. */
    close() {
      gen++;
      if (waiting) {
        io.kill(waiting.id);
        waiting.done(null);
      }
      v.running = false;
    },
  };
}

/**
 * Open the setup sheet. `alias`: the SSH host typed already (the Add sheet's).
 * @param {{ alias?: string, onToast?: (msg: string, kind?: string) => void }} [o]
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, sheet?: typeof sheet, show?: typeof showTerminal,
 *   app?: { sshSetup?: (input: any) => Promise<any>, openOn?: (id: string, route: string) => Promise<any> } | null,
 *   copy?: (text: string) => Promise<void> }} [io]
 * @returns {{ close: () => void, flow: ReturnType<typeof setupFlow> }}
 */
export function openSshSetup(o = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const app = io.app !== undefined ? io.app : /** @type {any} */ (globalThis).filamentApp ?? null;
  const show = io.show || showTerminal;
  const toast = o.onToast || (() => {});
  const { btn, copyBox, waiting, outcome, head } = taskSheetParts({ h: m, copy: io.copy || ((text) => navigator.clipboard.writeText(text)), toast, show });
  const field = /** @type {any} */ (m("input", {
    class: "zc-input ssh-host",
    type: "text",
    spellcheck: "false",
    autocomplete: "off",
    placeholder: "user@host, or a Host of your SSH config",
    "aria-label": "SSH host",
    value: String(o.alias || ""),
    onkeydown: (/** @type {KeyboardEvent} */ e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      void flow.start(field.value);
    },
  }));
  const termBox = m("div", { class: "tk-term" });
  /** The terminal shown: its view made once per terminal. @type {{ id: string, view: import("./lib/xterm.js").TerminalView | null }} */
  const term = { id: "", view: null };
  const body = m("div", { class: "tk-body" });
  const foot = m("div", { class: "tk-foot" });
  const flow = setupFlow(
    {
      run: async (input) => (app?.sshSetup ? app.sshSetup(input) : null),
      open: async (t) => {
        const r = await call("/terminal", { method: "POST", body: { program: { file: t.file, args: t.args }, title: t.title, cols: 100, rows: 24 } });
        const id = String(r?.terminal?.id || "");
        if (!id) throw new Error(String(r?.error || "Filament made none"));
        return id;
      },
      kill: (id) => void call(`/terminal/${encodeURIComponent(id)}/kill`, { method: "POST" }).catch(() => {}),
    },
    (v) => paint(v),
  );
  const s = (io.sheet || sheet)({
    label: "Set up a machine over SSH",
    head: head(m("span", { class: "tk-tile ssh-tile", "aria-hidden": "true", html: ICONS.server }), "Set up a machine over SSH", m("div", { class: "tk-sub" }, "Filament installed there, run as a service, and paired with this window")),
    body,
    foot,
    class: "tk-sheet ssh-sheet",
    onClose: () => {
      flow.close();
      term.view?.dispose();
    },
  });

  /** A step's mark: done, nothing to do, failed, a terminal yours to answer, running, or not yet. @param {StepRow["state"]} state */
  const mark = (state) =>
    m("span", { class: `ssh-mark is-${state}`, "aria-hidden": "true", html: state === "done" || state === "skipped" ? ICONS.check : state === "failed" ? ICONS.x : state === "ask" ? ICONS.terminal : state === "running" ? ICONS.loader : ICONS.circle });
  const said = { pending: "not yet", running: "under way", done: "done", skipped: "nothing to do", failed: "failed", ask: "asks you" };

  /** @param {SetupView} v */
  function paint(v) {
    const busy = v.running;
    field.disabled = busy;
    // The terminal shown while one runs, its view made once for it.
    if (v.term && term.id !== v.term.id) {
      term.view?.dispose();
      termBox.replaceChildren();
      term.id = v.term.id;
      const id = v.term.id;
      term.view = show(termBox, id, { onExit: (/** @type {number | null} */ code) => flow.terminalEnded(id, code) });
      queueMicrotask(() => term.view?.focus());
    } else if (!v.term && term.id) {
      term.view?.dispose();
      term.view = null;
      term.id = "";
      termBox.replaceChildren();
    }
    body.replaceChildren(
      ...[
        m("p", { class: "tk-lead" }, "On a Linux machine or a Windows host you reach with SSH — a server, a cloud VM: Filament installed in your user's own folder, run as a service (systemd's, or Windows' Task Scheduler), its coding agents connected and memory on, an https way in (your tailnet's, or its network's), and this window paired with it."),
        m("div", { class: "ssh-ask" }, field, btn("default", v.rows.length && !busy ? "Set up again" : "Set up", () => void flow.start(field.value), { disabled: busy })),
        m("p", { class: "tk-note" }, "It runs ssh with your keys and your SSH config. What only you answer — a host key it does not know, a password, sudo — you answer in a terminal here."),
        v.rows.length
          ? m(
              "ol",
              { class: "ssh-steps" },
              ...v.rows.map((r, i) =>
                m(
                  "li",
                  { class: `ssh-step is-${r.state}`, "data-step": r.id },
                  mark(r.state),
                  m(
                    "div",
                    { class: "ssh-step-text" },
                    m("b", {}, r.title, m("span", { class: "ssh-step-said" }, ` · ${said[r.state]}`)),
                    r.words ? m("span", {}, r.words) : null,
                    ...r.also.map((l, j) =>
                      m(
                        "div",
                        { class: "ssh-line" },
                        m("span", {}, l.words),
                        copyBox("tk-line", l.line, "The line"),
                        l.terminal ? m("div", { class: "ssh-acts" }, btn("secondary", "Run in a terminal", () => void flow.runLine(i, j), { disabled: busy })) : null,
                      ),
                    ),
                    r.state === "failed"
                      ? m("div", { class: "ssh-acts" }, r.offer ? btn("default", r.offer.label, () => void flow.take(i), { disabled: busy }) : null, btn("secondary", "Retry", () => void flow.retry(i), { disabled: busy }))
                      : null,
                  ),
                ),
              ),
            )
          : null,
        v.term ? m("div", { class: "ssh-term" }, waiting(v.term.why), termBox) : null,
        v.ended === "nothing"
          ? outcome("ok", "Nothing to do", m("span", {}, `${v.alias} is set up already${v.machine ? `, and ${v.machine.name} is in this window` : ""}.`))
          : v.ended === "set"
            ? outcome("ok", v.machine ? `${v.machine.name} is set up` : "Set up", m("span", {}, v.machine ? `${v.machine.name} is in this window: pick it in the machines menu.` : `${v.alias} is set up.`))
            : null,
      ].filter((x) => x != null),
    );
    const open = v.ended && v.machine && app?.openOn ? v.machine : null;
    foot.replaceChildren(
      ...(open ? [btn("secondary", `Open ${open.name}`, () => void Promise.resolve(app?.openOn?.(open.id, "#/")).then(() => s.close()))] : []),
      btn(v.ended ? "default" : "secondary", v.ended ? "Done" : "Close", () => s.close()),
    );
  }
  paint(flow.view());
  queueMicrotask(() => field.focus?.());
  return { close: () => s.close(), flow };
}
