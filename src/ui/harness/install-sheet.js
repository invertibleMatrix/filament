// @ts-check
// The install sheet (HarnessV3-ACP AC3-8): a coding agent installed from Settings → Coding agents, in the sign-in
// sheet's shape (lib/task-sheet.js). It first shows the command whole — what runs, and where it installs — and runs it
// on Install, in a terminal on the sheet: the installer's progress shows there, Cancel install stops it, and closing
// the sheet leaves it running (its row says "Installing…" and offers Show). Where no terminal can open here, it shows
// the line to run in a terminal of one's own, then Connect. An install that ends well has connected the agent: the
// sheet says so, shows its models as they come and who it runs as, and offers Sign in where nobody is signed in. How
// it ended is the entry's, followed through the events feed. Built with an injected `h`, `api`, sheet and terminal
// view, so it runs on the fake DOM.
import { h } from "../lib/dom.js";
import { cap, signedInUnnamed } from "../lib/accounts.js";
import { api } from "./lib/api.js";
import { markTile, modelCount } from "./lib/coding-agents.js";
import { taskSheetParts } from "./lib/task-sheet.js";
import { sheet } from "./lib/ui.js";
import { showTerminal } from "./lib/xterm.js";

/** @typedef {import("./lib/coding-agents.js").CodingAgent} CodingAgent */
/** @typedef {import("./lib/coding-agents.js").AgentsKeeper} AgentsKeeper */
/** @typedef {import("../lib/accounts.js").AccountKeeper} AccountKeeper */
/** @typedef {import("../lib/accounts.js").AgentRow} AgentRow */

/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);

/**
 * Where an install puts the agent, said under its command: for the whole computer, its maker's way, or into Filament's
 * own folder at the registry's version — a program there downloaded by Filament itself.
 * @param {CodingAgent} e @param {string} way
 */
const whereWords = (e, way) =>
  way === "npm"
    ? `npm installs ${e.name} for the whole computer, where your own terminals find it too.`
    : way === "script"
      ? `${e.name}'s own install script installs it for the whole computer, where your own terminals find it too.`
      : way === "binary"
        ? `Filament downloads ${e.name}${e.version ? ` ${e.version}` : ""} from its maker into its own folder and unpacks it there, its checksum checked where ACP's registry gives one. Nothing else on this computer changes.`
        : `${way === "uvx" ? "uv" : "npm"} installs ${e.name}${e.version ? ` ${e.version}` : ""} into Filament's own folder. Nothing else on this computer changes.`;

/**
 * Open the install sheet for an agent: its install under way where there is one, else its command, run on Install.
 * An agent whose registry has a newer version than the one here — Filament's install of it, or the one npm installed
 * (HarnessV3-ACP AF3) — is updated: the same sheet, its words an update's.
 * @param {string} id  the agent's entry
 * @param {{ agents: AgentsKeeper, accounts: AccountKeeper, signIn: (upstream: string) => void,
 *   onToast?: (msg: string, kind?: string) => void }} o
 *   `signIn`: the sign-in sheet, for an account
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, sheet?: typeof sheet, show?: typeof showTerminal,
 *   copy?: (text: string) => Promise<void> }} [io]
 * @returns {{ close: () => void }}
 */
export function openInstall(id, o, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const toast = o.onToast || (() => {});
  const { btn, copyBox, waiting, outcome, head, terminal } = taskSheetParts({
    h: m,
    copy: io.copy || ((text) => navigator.clipboard.writeText(text)),
    toast,
    show: io.show || showTerminal,
  });
  const entry = () => o.agents.now()?.entries.find((e) => e.id === id) || null;
  const route = `/coding-agents/${encodeURIComponent(id)}`;
  const first = entry();

  /**
   * Where the sheet stands: its command shown before it runs, asking the server, an install under way in the sheet's
   * terminal, the line to run where no terminal opens, how the install ended, or the server's refusal.
   */
  const st = {
    /** @type {"confirm" | "asking" | "terminal" | "line" | "ended" | "refused"} */ phase: "confirm",
    /** The install shown: its end is read once the entry's last one is as new. @type {CodingAgent["installing"]} */ installing: null,
    /** It replaces an older version. */ updating: !!first?.update,
    line: "",
    /** @type {CodingAgent["lastInstall"]} */ end: null,
    error: "",
    busy: false,
    /** The line's Connect: asked, and why it was refused. */ connecting: false,
    connectError: "",
  };
  const noun = st.updating ? "update" : "install";
  /** The version an update installs, as the registry said it when the sheet opened: once settled, it's no update. */
  const updateTo = st.updating ? first?.update || "" : "";
  /** The install's terminal: kept while it runs, and after a failed one, whose words it holds. */
  const term = terminal();
  const sub = m("div", { class: "tk-sub" });
  const body = m("div", { class: "tk-body" });
  const foot = m("div", { class: "tk-foot" });
  let closed = false;
  /** What was painted last: a read that changes nothing here paints nothing (a terminal keeps the keys). */
  let painted = "";
  /** The hooks on the entries and the accounts, let go of with the sheet. */
  let offAgents = () => {};
  let offAccounts = () => {};
  const title = st.updating ? "Update" : "Install";
  const s = (io.sheet || sheet)({
    label: `${title} ${first?.name || id}`,
    head: head(markTile(m, first || { mark: null, name: id }), title, sub),
    body,
    foot,
    class: "tk-sheet",
    onClose: () => {
      closed = true;
      offAgents();
      offAccounts();
      term.drop();
    },
  });

  /** Ask the server to install the agent; its answer is the install under way, or the line to run where none can. */
  async function start() {
    st.phase = "asking";
    st.end = null;
    st.installing = null;
    st.error = "";
    term.drop();
    paint();
    try {
      const r = await call(`${route}/install`, { method: "POST" });
      o.agents.keep(r);
      if (r?.installing) {
        st.phase = "terminal";
        st.installing = r.installing;
      } else {
        st.phase = "line";
        st.line = String(r?.line || "");
      }
    } catch (e) {
      st.phase = "refused";
      st.error = errText(e);
    }
    // The install may have ended before its answer came: the entry as read last says so.
    follow();
  }

  async function cancel() {
    st.busy = true;
    paint();
    try {
      o.agents.keep(await call(`${route}/install/cancel`, { method: "POST" }));
    } catch (e) {
      toast(`Couldn't stop the ${noun}: ${errText(e)}`, "err");
    }
    st.busy = false;
    follow();
  }

  /** The line run in a terminal of the person's own: Connect finds what it installed, or says why not. */
  async function connect() {
    st.connecting = true;
    st.connectError = "";
    paint();
    try {
      o.agents.keep(await call(`${route}/connect`, { method: "POST" }));
      st.phase = "ended";
      st.end = { outcome: "installed", error: null, at: Date.now() };
    } catch (e) {
      st.connectError = errText(e);
    }
    st.connecting = false;
    paint();
  }

  /** The entry read again: an install under way is shown; one that ended, once its end is as new as it. */
  function follow() {
    if (closed) return;
    const e = entry();
    if (e?.installing) {
      st.installing = e.installing;
      st.phase = "terminal";
    } else if (st.installing && st.phase === "terminal" && e?.lastInstall && e.lastInstall.at >= st.installing.at) {
      st.phase = "ended";
      st.end = e.lastInstall;
      if (e.lastInstall.outcome === "installed") term.drop();
    }
    paint();
  }

  /** The agent's models as they come, after it connected. @param {CodingAgent | null} e */
  const modelsLine = (e) =>
    !e
      ? null
      : e.asking
        ? m("span", {}, "Asking for its models…")
        : e.modelsError
          ? m("span", {}, `It couldn't list its models: ${e.modelsError}.`)
          : e.models
            ? m("span", {}, e.models.count ? `${modelCount(e.models.count)} ready in the picker.` : "It lists no models yet.")
            : null;

  /**
   * Who its account runs as, once it said; whether nobody is signed in; whether someone is, as nobody said whom
   * (`unnamed`: its sign-in is said too).
   * @param {AgentRow | null} r
   */
  const accountOf = (r) => {
    const id = r?.account?.identity || null;
    const nobody = !!id && (!!r?.account?.signedOut || id.kind === "none");
    const unnamed = signedInUnnamed(r?.account);
    return { said: !!id || unnamed, nobody, unnamed, label: id && !nobody ? id.label : "" };
  };

  function paint() {
    if (closed) return;
    const e = entry();
    const r = e?.primary ? o.accounts.rows().find((x) => x.upstream === e.primary) || null : null;
    const who = accountOf(r);
    const key = JSON.stringify([st, e && [e.name, e.install, e.version, e.update, e.installed, e.runs, e.models, e.asking, e.modelsError], who, r?.ways.length]);
    if (key === painted) return;
    painted = key;
    const version = st.installing?.version || (st.updating ? updateTo : e?.version) || "";
    sub.replaceChildren(`${e?.name || id}${version ? ` · ${version}` : ""}`);
    /** @type {any[]} */
    let parts = [];
    /** @type {any[]} */
    let acts = [];
    let note = "";
    if (st.phase === "confirm") {
      const way = e?.install;
      if (!e) {
        parts = [waiting("Reading the agent…")];
        acts = [btn("secondary", "Cancel", () => s.close())];
      } else if (!way) {
        parts = [outcome("stop", `Filament can't install ${e.name} on this computer`, e.download ? m("span", {}, "Download it from its maker, then Connect.") : null)];
        acts = [btn("default", "Close", () => s.close())];
      } else {
        const runs = way.way === "binary" ? "Filament downloads this in a terminal here:" : "Filament runs this in a terminal here:";
        parts = [
          m("p", { class: "tk-lead" }, st.updating && e.update ? `Updating ${e.name} from ${e.installed?.version || e.runs} to ${e.update}. ${runs}` : runs),
          copyBox("tk-line", way.line, way.way === "binary" ? "The address" : "The command"),
          m("p", { class: "tk-note" }, whereWords(e, way.way)),
          way.needs ? m("p", { class: "tk-error", role: "alert" }, `It needs ${way.needs}, which isn't on this computer yet.`) : null,
        ];
        acts = [btn("secondary", "Cancel", () => s.close()), btn("default", title, () => void start(), { disabled: !!way.needs })];
      }
    } else if (st.phase === "asking") {
      parts = [waiting(`Starting the ${noun}…`)];
      acts = [btn("secondary", "Cancel", () => s.close())];
    } else if (st.phase === "terminal" && st.installing) {
      const fetched = e?.install?.way === "binary";
      parts = [
        m("p", { class: "tk-lead" }, `${st.updating ? "Updating" : "Installing"} ${e?.name || id}: its ${fetched ? "download" : "installer"}'s progress shows below.`),
        copyBox("tk-line", st.installing.line, fetched ? "The address" : "The command"),
        term.of(st.installing.terminal),
      ];
      note = "Closing this sheet leaves it running.";
      acts = [btn("secondary", st.busy ? "Stopping…" : `Cancel ${noun}`, () => void cancel(), { disabled: st.busy })];
    } else if (st.phase === "line") {
      parts = [
        m("p", { class: "tk-lead" }, "Filament can't open a terminal on this computer. Run this in a terminal of your own, then Connect:"),
        copyBox("tk-line", st.line, "The command"),
        st.connectError ? m("p", { class: "tk-error", role: "alert" }, `${cap(st.connectError)}.`) : null,
      ];
      acts = [btn("secondary", "Done", () => s.close()), btn("default", st.connecting ? "Connecting…" : "Connect", () => void connect(), { disabled: st.connecting })];
    } else if (st.phase === "ended" && st.end) {
      const end = st.end;
      if (end.outcome === "installed") {
        parts = [outcome("ok", st.updating ? `Updated${version ? ` to ${version}` : ""}` : "Installed and connected", [
          modelsLine(e),
          who.label ? m("span", {}, `It runs as ${who.label}.`) : who.unnamed ? m("span", {}, "It is signed in.") : who.nobody ? m("span", {}, "Nobody is signed in yet.") : null,
        ])];
        const signIn = () => {
          s.close();
          if (r) o.signIn(r.upstream);
        };
        acts = r && r.ways.length && who.nobody
          ? [btn("secondary", "Close", () => s.close()), btn("default", "Sign in", signIn)]
          : r && r.ways.length && !who.said
            ? [btn("secondary", "Sign in", signIn), btn("default", "Done", () => s.close())]
            : [btn("default", "Done", () => s.close())];
      } else {
        const ended = end.outcome === "cancelled" ? `The ${noun} was stopped` : `The ${noun} didn't finish`;
        parts = [term.shown() ? term.box() : null, outcome("stop", ended, end.error ? m("span", {}, `${cap(end.error)}.`) : null)];
        acts = [btn("secondary", "Close", () => s.close()), btn("default", "Try again", () => void start())];
      }
    } else {
      parts = [outcome("stop", `The ${noun} can't start`, m("span", {}, `${cap(st.error)}.`))];
      acts = [btn("secondary", "Close", () => s.close()), btn("default", "Try again", () => void start())];
    }
    body.replaceChildren(...parts.filter(Boolean));
    foot.replaceChildren(m("span", { class: "tk-foot-note" }, note), ...acts);
    term.focusFresh();
  }

  // A keeper hands a new hook its last read at once — an install under way is shown from the start — so the sheet
  // is whole by now.
  offAgents = o.agents.listen(() => follow());
  offAccounts = o.accounts.listen(() => paint());
  paint();
  return { close: () => s.close() };
}
