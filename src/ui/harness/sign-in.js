// @ts-check
// The sign-in sheet (HarnessV3-ACP AC3-7): an account of a coding agent signs in here, its agent's own way, from where
// it was asked — Settings → Coding agents, the Account instrument, a turn its login refused. Where the agent offers
// more than one way, the sheet names them first (Claude's subscription or its Console; ChatGPT's page here, or a code
// typed on another computer — picked first on a page that reaches Filament from another computer, as ChatGPT's page
// comes back to Filament's alone). A sign-in in a terminal runs in the sheet; one on a page waits for it, with the
// page to open, the code to type where there is one, and Cancel — or, where the agent opens its page itself, its words
// alone; where no terminal can open, the line to run in one's own. A key's way (Codex's OpenAI API key, a key an ACP
// agent reads from a variable) has its field under the ways: the key goes in the sign-in's body and nowhere else, the
// field emptied as it goes, and the sheet waits while it is checked. How it ended is the account's row — the server's,
// followed through the events feed: signed in as whom, or why not, with Try again. Closing the sheet leaves a sign-in
// running (the account's row offers it again); Cancel stops it.
// Built with an injected `h`, `api`, sheet, terminal view and page address, so it runs on the fake DOM; its parts are
// the task sheets' (lib/task-sheet.js), which the install sheet shares.
import { h } from "../lib/dom.js";
import { accountName, cap, maskEmail, signedInUnnamed } from "../lib/accounts.js";
import { api } from "./lib/api.js";
import { ICONS } from "./lib/icons.js";
import { taskSheetParts } from "./lib/task-sheet.js";
import { sheet } from "./lib/ui.js";
import { showTerminal } from "./lib/xterm.js";

/** @typedef {import("../lib/accounts.js").AgentRow} AgentRow */
/** @typedef {import("../lib/accounts.js").SignIn} SignIn */
/** @typedef {import("../lib/accounts.js").SignInEnd} SignInEnd */
/** @typedef {import("../lib/accounts.js").AccountKeeper} AccountKeeper */

/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);

/**
 * The ways that finish from a browser on another computer than Filament's (the owner's remote Filament of 11-06):
 * Codex's code, typed on ChatGPT's page. Codex's page way comes back to localhost on Filament's computer alone.
 */
export const ANOTHER_COMPUTER_WAYS = Object.freeze(["chatgpt-code"]);

/** What the sheet says under the ways where it picked one of those first. */
export const ANOTHER_COMPUTER_NOTE = "You reach Filament from another computer: the code works from this browser.";

/**
 * Whether this page reaches Filament from another computer: its address names no loopback of this one — tailscale
 * serve's name, the network listener's address. An SSH tunnel's localhost is not told from Filament's own computer,
 * as the server does not tell it either (guards.js `isLocalCaller`).
 * @param {{ hostname?: string } | null | undefined} here  the page's `location`
 */
export function fromAnotherComputer(here) {
  const n = String(here?.hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  return !!n && n !== "localhost" && !n.endsWith(".localhost") && n !== "::1" && !/^127\./.test(n);
}

/**
 * Open the sign-in sheet for an account (an agent upstream): the sign-in under way where there is one, else a new one.
 * `then`: what the sheet offers once signed in, in place of Done (a turn its login refused: Send again).
 * @param {string} upstream
 * @param {{ keeper: AccountKeeper, onToast?: (msg: string, kind?: string) => void, then?: { label: string, run: () => void } }} o
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, sheet?: typeof sheet, show?: typeof showTerminal,
 *   open?: (url: string) => void, copy?: (text: string) => Promise<void>, here?: { hostname?: string } | null }} [io]
 *   `here`: this page's address (its `location`), which says whether it reaches Filament from another computer
 * @returns {{ close: () => void }}
 */
export function openSignIn(upstream, o, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const openPage = io.open || ((url) => void window.open(url, "_blank", "noopener"));
  const far = fromAnotherComputer(io.here !== undefined ? io.here : globalThis.location);
  const toast = o.onToast || (() => {});
  const { btn, copy, copyBox, altLine, waiting, outcome, head, terminal } = taskSheetParts({
    h: m,
    copy: io.copy || ((text) => navigator.clipboard.writeText(text)),
    toast,
    show: io.show || showTerminal,
  });
  const rowOf = () => o.keeper.rows().find((r) => r.upstream === upstream) || null;
  const route = `/agent-accounts/${encodeURIComponent(upstream)}`;

  /**
   * Where the sheet stands: asking the server, choosing a way, a sign-in under way (in a terminal or on a page), the
   * line to run where no terminal opens, how the sign-in ended, or the server's refusal.
   */
  const st = {
    /** @type {"asking" | "choose" | "terminal" | "browser" | "key" | "line" | "ended" | "refused"} */ phase: "asking",
    /** @type {import("../lib/accounts.js").Way[]} */ ways: [],
    picked: "",
    /** The sign-in shown: its end is read once the row's last one is as new. @type {SignIn | null} */ signIn: null,
    line: "",
    /** @type {SignInEnd | null} */ end: null,
    error: "",
    busy: false,
    checking: false,
    /** The email stays masked until asked for. */ shown: false,
  };
  /** The sign-in's terminal: kept while its sign-in runs, and after a failed one, whose words it holds. */
  const term = terminal();
  /**
   * A key's field, made once: painting the sheet again keeps what is typed in it. The key is never in the sheet's state:
   * it goes in the sign-in's body, and the field is emptied as it goes.
   */
  const keyField = /** @type {any} */ (m("input", {
    class: "zc-input si-key-in",
    type: "password",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "Paste the key",
    onkeydown: (/** @type {KeyboardEvent} */ e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      withKey();
    },
  }));
  const sub = m("div", { class: "tk-sub" });
  const body = m("div", { class: "tk-body" });
  const foot = m("div", { class: "tk-foot" });
  let closed = false;
  /** What was painted last: an accounts read that changes nothing here paints nothing (a terminal keeps the keys). */
  let painted = "";
  const off = o.keeper.listen(() => follow());
  const s = (io.sheet || sheet)({
    label: "Sign in",
    head: head(m("span", { class: "tk-tile si-tile", "aria-hidden": "true", html: ICONS.user }), "Sign in", sub),
    body,
    foot,
    class: "tk-sheet",
    onClose: () => {
      closed = true;
      off();
      term.drop();
      keyField.value = "";
    },
  });

  /**
   * Ask the server to sign in, by the way chosen — with its key, for a key's way; with none, the server takes the agent's
   * one way or names them. @param {string} [way] @param {string} [key]
   */
  async function start(way, key) {
    st.busy = true;
    paint();
    try {
      const r = await call(`${route}/sign-in`, { method: "POST", body: way ? { way, ...(key ? { key } : {}) } : {} });
      if (r?.choose) {
        st.phase = "choose";
        st.ways = r.choose;
        // From another computer, a way that finishes there first (Codex's code): its page way never comes back here.
        const there = far ? st.ways.find((w) => ANOTHER_COMPUTER_WAYS.includes(w.id))?.id : "";
        st.picked = st.ways.some((w) => w.id === st.picked) ? st.picked : there || st.ways[0]?.id || "";
      } else if (r?.signIn) {
        st.phase = r.signIn.kind;
        st.signIn = r.signIn;
      } else {
        st.phase = "line";
        st.line = String(r?.line || "");
      }
    } catch (e) {
      st.phase = "refused";
      st.error = errText(e);
    }
    st.busy = false;
    // The sign-in may have ended before its answer came: the row as read last says so.
    follow();
  }

  async function cancel() {
    st.busy = true;
    paint();
    try {
      await call(`${route}/sign-in/cancel`, { method: "POST" });
      s.close();
    } catch (e) {
      st.busy = false;
      toast(`Couldn't cancel the sign-in: ${errText(e)}`, "err");
      paint();
    }
  }

  /** Sign in with the key in the field, by the way picked; with none in it, the field takes the focus again. */
  function withKey() {
    const key = String(keyField.value || "").trim();
    if (!key) return void keyField.focus?.();
    keyField.value = "";
    void start(st.picked, key);
  }

  /** @param {string} [way] */
  const again = (way) => {
    st.phase = "asking";
    st.end = null;
    st.signIn = null;
    term.drop();
    void start(way);
  };

  /** The account's row read again: a sign-in under way is shown; one that ended, once its end is as new as it. */
  function follow() {
    if (closed) return;
    const r = rowOf();
    if (r?.signingIn) {
      st.signIn = r.signingIn;
      st.phase = r.signingIn.kind;
    } else if (st.signIn && (st.phase === "terminal" || st.phase === "browser" || st.phase === "key") && r?.lastSignIn && r.lastSignIn.at >= st.signIn.at) {
      st.phase = "ended";
      st.end = r.lastSignIn;
      if (r.lastSignIn.outcome === "signed-in") term.drop();
    }
    paint();
  }

  /** Who the account runs as now: its plan or kind, and its email masked until clicked; null with nobody. @param {AgentRow | null} r */
  const who = (r) => {
    const id = r?.account?.identity;
    if (!id || r?.account?.signedOut || id.kind === "none") return null;
    return m("span", { class: "si-who" },
      id.label,
      id.email ? m("button", {
        class: "si-email",
        type: "button",
        title: st.shown ? "Hide the email" : "Show the email",
        "aria-pressed": st.shown ? "true" : "false",
        onclick: () => { st.shown = !st.shown; paint(); },
      }, st.shown ? id.email : maskEmail(id.email)) : null);
  };

  function paint() {
    if (closed) return;
    const r = rowOf();
    const id = r?.account?.identity;
    const key = JSON.stringify([st, r ? accountName(r) : "", id?.label, id?.email, id?.kind, r?.account?.signedOut, signedInUnnamed(r?.account)]);
    if (key === painted) return;
    painted = key;
    sub.replaceChildren(r ? accountName(r) : upstream);
    /** @type {any[]} */
    let parts = [];
    /** @type {any[]} */
    let acts = [];
    let note = "";
    if (st.phase === "asking") {
      parts = [waiting("Starting the sign-in…")];
      acts = [btn("secondary", "Cancel", () => s.close())];
    } else if (st.phase === "choose") {
      parts = [
        m("p", { class: "tk-lead" }, "How do you want to sign in?"),
        m("div", { class: "si-ways", role: "radiogroup", "aria-label": "Ways to sign in" },
          ...st.ways.map((w) => m("button", {
            class: `si-way${w.id === st.picked ? " is-on" : ""}`,
            type: "button",
            role: "radio",
            "aria-checked": w.id === st.picked ? "true" : "false",
            onclick: () => { st.picked = w.id; paint(); },
          }, m("span", { class: "si-way-dot", "aria-hidden": "true" }), m("span", { class: "si-way-text" }, m("b", {}, w.name), w.description ? m("span", {}, w.description) : null)))),
      ];
      // A key's way, picked: its field under the ways, named in the agent's words, and Sign in in Continue's place.
      const keyed = st.ways.find((w) => w.id === st.picked && w.kind === "key");
      if (keyed) {
        keyField.setAttribute("aria-label", keyed.label || keyed.name);
        parts.push(m("label", { class: "si-key" }, m("span", { class: "si-key-label" }, keyed.label || keyed.name), keyField));
      }
      if (far && st.ways.some((w) => ANOTHER_COMPUTER_WAYS.includes(w.id))) note = ANOTHER_COMPUTER_NOTE;
      acts = [
        btn("secondary", "Cancel", () => s.close()),
        keyed
          ? btn("default", st.busy ? "Signing in…" : "Sign in", () => withKey(), { disabled: st.busy })
          : btn("default", st.busy ? "Starting…" : "Continue", () => void start(st.picked), { disabled: st.busy || !st.picked }),
      ];
    } else if (st.phase === "terminal" && st.signIn?.kind === "terminal") {
      parts = [
        m("p", { class: "tk-lead" }, `Signing in with ${st.signIn.name}: follow the steps in the terminal below. It may open a page in your browser.`),
        term.of(st.signIn.terminal),
        st.signIn.line ? altLine("Or run it in a terminal of your own", st.signIn.line) : null,
      ];
      note = "Closing this sheet leaves it running.";
      acts = [btn("secondary", st.busy ? "Cancelling…" : "Cancel sign-in", () => void cancel(), { disabled: st.busy })];
    } else if (st.phase === "browser" && st.signIn?.kind === "browser") {
      const b = st.signIn;
      const url = b.url;
      // An agent that carries out its sign-in itself (an ACP agent's `authenticate`) opens its page of its own: no link here.
      parts = url
        ? [
            m("p", { class: "tk-lead" }, b.code
              ? `Signing in with ${b.name}: open the sign-in page in any browser, sign in, and type this code there:`
              : `Signing in with ${b.name}: open the sign-in page and sign in there. This sheet follows it.`),
            b.code ? copyBox("si-code", b.code, "The code") : null,
            m("div", { class: "si-page" },
              btn("default", "Open the sign-in page", () => openPage(url)),
              btn("secondary", "Copy link", () => void copy(url, "The link"))),
            waiting("Waiting for you to sign in on the page — up to 15 minutes."),
          ]
        : [
            m("p", { class: "tk-lead" }, `Signing in with ${b.name}: ${r?.agentName || "the agent"} carries it out itself, and may open its sign-in page in your browser — finish there. This sheet follows it.`),
            waiting("Waiting for the sign-in to finish — up to 15 minutes."),
          ];
      if (b.line) parts.push(altLine("Or sign in with its CLI, in a terminal", b.line));
      acts = [btn("secondary", st.busy ? "Cancelling…" : "Cancel sign-in", () => void cancel(), { disabled: st.busy })];
    } else if (st.phase === "key" && st.signIn?.kind === "key") {
      parts = [waiting(`Signing in with ${st.signIn.name}…`)];
      acts = [btn("secondary", "Close", () => s.close())];
    } else if (st.phase === "line") {
      const now = who(r);
      parts = [
        m("p", { class: "tk-lead" }, "Filament can't open a terminal on this computer. Run this in a terminal of your own, then Check now:"),
        copyBox("tk-line", st.line, "The line"),
        m("p", { class: "si-now" }, now ? ["Now signed in as ", now] : signedInUnnamed(r?.account) ? "Now signed in." : "Nobody is signed in yet."),
      ];
      acts = [btn("secondary", "Done", () => s.close()), btn("default", st.checking ? "Checking…" : "Check now", () => {
        st.checking = true;
        paint();
        o.keeper.check(upstream).finally(() => { st.checking = false; paint(); });
      }, { disabled: st.checking })];
    } else if (st.phase === "ended" && st.end) {
      const e = st.end;
      if (e.outcome === "signed-in" || e.outcome === "key-kept") {
        // A key nothing could check is kept, and said as that, never as signed in: a turn is what tries it.
        parts = [e.outcome === "signed-in" ? outcome("ok", "Signed in", who(r)) : outcome("ok", "Key kept", m("span", {}, "Its next turn tries it."))];
        acts = o.then
          ? [btn("secondary", "Close", () => s.close()), btn("default", o.then.label, () => { s.close(); o.then?.run(); })]
          : [btn("default", "Done", () => s.close())];
      } else {
        const title = e.outcome === "cancelled" ? "The sign-in was stopped" : e.outcome === "signed-out" ? "Signed out" : "The sign-in didn't finish";
        parts = [term.shown() ? term.box() : null, outcome("stop", title, e.error ? m("span", {}, `${cap(e.error)}.`) : null)];
        acts = [btn("secondary", "Close", () => s.close()), btn("default", e.outcome === "signed-out" ? "Sign in" : "Try again", () => again())];
      }
    } else {
      parts = [outcome("stop", "The sign-in can't start", m("span", {}, `${cap(st.error)}.`))];
      acts = [btn("secondary", "Close", () => s.close()), btn("default", "Try again", () => again(st.picked || undefined))];
    }
    body.replaceChildren(...parts.filter(Boolean));
    foot.replaceChildren(m("span", { class: "tk-foot-note" }, note), ...acts);
    term.focusFresh();
  }

  const open = rowOf()?.signingIn;
  if (open) {
    st.signIn = open;
    st.phase = open.kind;
    paint();
  } else void start();
  return { close: () => s.close() };
}
