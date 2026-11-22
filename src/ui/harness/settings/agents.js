// @ts-check
// Settings → Coding agents (HarnessV3-ACP AC3-7, AC3-8): the coding agents Filament runs, and the ones it can add.
// - *Your agents:* a card per agent connected or turned off. A card wears its maker's mark, says what the agent does in
//   a chat (a chip per capability its profile declares that a chat feels, its meaning on hover) and how many models it
//   lists (Refresh asks again), then its accounts — whose plan a turn spends, and how much of it is left. An account's
//   row names it ("Default", or the name it was added under) and who it runs as — its plan, its email masked until
//   clicked — with a meter for each window of its plan and when that was heard; then Sign in where nobody is (the
//   sign-in sheet), Sign out where its agent signs out, Use a reset credit where its plan is spent and it holds one,
//   Check now, and in its menu Sign in again, Rename and Remove for an added account. Add account names a new one and
//   signs it in at once; an agent that keeps one login on a computer says why instead. The card's menu turns the agent
//   off (its accounts and their logins kept; its card becomes a short one with Turn on), links its docs, and for an
//   agent Filament installed says its version, updates it and removes it from this computer. An agent whose program is
//   gone says so, with what brings it back. Under its accounts, its models fold: the rows a provider's page shows
//   (lib/model-rows.js), for the account its models line reads.
// - *Add a coding agent:* the agents Filament knows, then ACP's registry's by name, with a search field. A row says what
//   the agent is, who makes it and how it installs, and offers one thing: Connect, Install… (the install sheet), the
//   page to get the installer it needs, its download, or why there's none for this computer.
// The state is the server's, as the page keeps it (its agents keeper and accounts keeper, read again with each change
// the events feed announces); every change goes through the routes, a refusal said in the server's words. Built with
// an injected `h`, `api`, menu and dialogs, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { COVERED, accountName, cap, checkWords, keyWords, maskEmail, percentWords, readsAs, resetWords, signedInUnnamed, toneOf, windowName, windowTag } from "../../lib/accounts.js";
import { supportsRows } from "../../lib/agent-profile.js";
import { api } from "../lib/api.js";
import { onBus } from "../lib/bus.js";
import { NEEDS_PAGE, installWords, makerWords, markTile, matches, modelCount, retiredWords } from "../lib/coding-agents.js";
import { ICONS } from "../lib/icons.js";
import { createModelRows } from "../lib/model-rows.js";
import { providersState } from "../lib/providers-state.js";
import { routeFor } from "../lib/router.js";
import { confirmDialog, dialog, menu } from "../lib/ui.js";
import { ago } from "../widgets/kit.js";

/** @typedef {import("../../lib/accounts.js").AgentRow} AgentRow */
/** @typedef {import("../../lib/accounts.js").AccountKeeper} AccountKeeper */
/** @typedef {import("../lib/coding-agents.js").CodingAgent} CodingAgent */
/** @typedef {import("../lib/coding-agents.js").CodingAgents} CodingAgents */
/** @typedef {import("../lib/coding-agents.js").AgentsKeeper} AgentsKeeper */

/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);

/**
 * The capabilities a card shows: the ones a chat feels. The rest (closing, queueing, forking a session…) stay on the
 * console's Agents table.
 */
const FELT = new Set(["reopen", "list", "steering", "images", "files", "tools", "subagents"]);

/**
 * How an agent keeps its accounts, said under its name: each signs in on its own, or each is a key its page makes;
 * an agent that keeps one login says why.
 * @param {AgentRow} r
 */
const styleWords = (r) =>
  r.style === "folder"
    ? "Each account signs in on its own: add one for each login you use."
    : r.style === "key"
      ? `Each account signs in on ${r.agentName.replace(/ \(.*\)$/, "")}'s page, which makes it a key of its own.`
      : `${cap(r.oneAccount || "it keeps one login on this computer")}.`;

/** Whether nobody is signed in, as the agent said. @param {AgentRow} r */
const nobody = (r) => !!r.account?.identity && (r.account.signedOut || r.account.identity.kind === "none");
/** Who the account runs as, as the agent said; null before it said, or with nobody signed in. @param {AgentRow} r */
const whoOf = (r) => (r.account?.identity && !nobody(r) ? r.account.identity : null);

/**
 * @param {HTMLElement} body
 * @param {{ accounts: AccountKeeper, agents: AgentsKeeper, signIn: (upstream: string) => void, install: (id: string) => void,
 *   useResetCredit: (upstream: string) => Promise<unknown>, onToast?: (msg: string, kind?: string) => void,
 *   now?: () => number }} cb
 *   `signIn`: the sign-in sheet, for an account; `install`: the install sheet, for an agent; `useResetCredit`: one of
 *   a Codex account's reset credits, once the person says so
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, confirm?: typeof confirmDialog, dialog?: typeof dialog, menu?: typeof menu,
 *   copy?: (text: string) => Promise<void>, open?: (url: string) => void, subscribe?: (fn: (msg: any) => void) => () => void }} [io]
 */
export function renderAgents(body, cb, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const ask = io.confirm || confirmDialog;
  const openDialog = io.dialog || dialog;
  const menuOf = io.menu || menu;
  const subscribe = io.subscribe || onBus;
  const copyText = io.copy || ((text) => navigator.clipboard.writeText(text));
  const openPage = io.open || ((url) => void window.open(url, "_blank", "noopener"));
  const toast = cb.onToast || (() => {});
  const now = cb.now || Date.now;
  const keeper = cb.accounts;
  const agents = cb.agents;

  /** The rows a person is acting on (a check, a sign-out…), by upstream: their buttons wait. @type {Set<string>} */
  const busy = new Set();
  /** The agents a person is acting on (connect, turn off, remove…), by entry: their buttons wait. @type {Set<string>} */
  const working = new Set();
  /** The emails asked to be shown, by upstream. @type {Set<string>} */
  const shown = new Set();
  /** What the list is searched for. */
  let query = "";
  /**
   * The ⋯ buttons a menu of the page's stands on: while any does, the page stands as it is, then draws what was read
   * meanwhile — a card drawn anew under a menu took its ⋯ away, and the menu with it (the owner's of 11-05: every menu
   * here closed a couple of seconds after it opened, at the accounts' next read).
   * @type {Set<HTMLElement>}
   */
  const menusOn = new Set();
  /** @param {any[]} items @param {{ anchor: HTMLElement, align?: "start" | "end", width?: number }} o */
  const openMenu = (items, o) => {
    // A second press on its ⋯ closes the menu there, and opens none.
    if (menusOn.has(o.anchor)) return void menuOf(items, o);
    menusOn.add(o.anchor);
    const letGo = () => {
      menusOn.delete(o.anchor);
      paint();
    };
    menuOf(items, { ...o, onClose: () => {
      // A press elsewhere closed it: the page holds until that press ends, so the button it began on is the one it
      // ends on.
      const ev = typeof window === "undefined" ? null : window.event;
      if (ev?.type !== "pointerdown") return letGo();
      const later = () => {
        window.removeEventListener("pointerup", later, true);
        window.removeEventListener("pointercancel", later, true);
        setTimeout(letGo, 0);
      };
      window.addEventListener("pointerup", later, true);
      window.addEventListener("pointercancel", later, true);
    } });
  };

  /** @param {string} variant @param {string} label @param {() => void} onClick @param {{ disabled?: boolean, title?: string, cls?: string }} [x] */
  const btn = (variant, label, onClick, x = {}) =>
    m("button", {
      class: `zc-btn zc-btn-v-${variant} zc-btn-s-sm${x.cls ? ` ${x.cls}` : ""}`,
      type: "button",
      ...(x.disabled ? { disabled: "" } : {}),
      ...(x.title ? { title: x.title } : {}),
      onclick: onClick,
    }, label);
  /** @param {string} name @param {string} label @param {() => void} onClick @param {{ disabled?: boolean, cls?: string }} [x] */
  const iconBtn = (name, label, onClick, x = {}) =>
    m("button", {
      class: `cag-icon${x.cls ? ` ${x.cls}` : ""}`,
      type: "button",
      title: label,
      "aria-label": label,
      ...(x.disabled ? { disabled: "" } : {}),
      html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "",
      onclick: onClick,
    });
  /** A page elsewhere, opened in a new tab, as a capsule with its arrow. @param {string} label @param {string} href @param {string} title */
  const linkBtn = (label, href, title) =>
    m("a", { class: "zc-btn zc-btn-v-secondary zc-btn-s-sm cag-link", href, target: "_blank", rel: "noopener noreferrer", title },
      label, m("span", { class: "cag-link-ic", "aria-hidden": "true", html: ICONS.externalLink }));
  /** @param {string} words */
  const spinning = (words) =>
    m("span", { class: "cag-wait", role: "status" }, m("span", { class: "tk-spin", "aria-hidden": "true", html: ICONS.loader }), words);

  // ---- an account ---------------------------------------------------------------------------------------------------

  /**
   * Ask of an account through its route; the account as it then stands replaces the page's copy, a refusal is said.
   * @param {AgentRow} r @param {string} path @param {string} failed
   */
  const word = async (r, path, failed) => {
    busy.add(r.upstream);
    paint();
    try {
      const out = await call(`/agent-accounts/${encodeURIComponent(r.upstream)}${path}`, { method: "POST" });
      if (out?.agent) keeper.keep(out.agent);
    } catch (e) {
      toast(`${failed}: ${errText(e)}`, "err");
    } finally {
      busy.delete(r.upstream);
      paint();
    }
  };

  /**
   * A name asked for on a dialog and handed to `submit`; the server's refusal stays on the dialog, under the field.
   * @param {{ title: string, description: string, value?: string, confirm: string, submit: (name: string) => Promise<void> }} x
   */
  const askName = (x) => {
    const input = /** @type {HTMLInputElement} */ (m("input", {
      class: "zc-input cag-name-input", type: "text", value: x.value || "", maxlength: "40", spellcheck: "false",
      placeholder: "Work", "aria-label": "The account's name",
    }));
    const error = m("p", { class: "cag-error", role: "alert" });
    let sending = false;
    const go = async () => {
      if (sending) return;
      const name = String(input.value || "").trim();
      if (!name) return void error.replaceChildren("Name the account.");
      sending = true;
      try {
        await x.submit(name);
        d.close();
      } catch (e) {
        error.replaceChildren(`${cap(errText(e))}.`);
      } finally {
        sending = false;
      }
    };
    input.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void go();
      }
    });
    const d = openDialog({
      title: x.title,
      description: x.description,
      body: m("div", { class: "cag-ask" }, input, error),
      actions: [{ label: "Cancel", variant: "outline", onClick: () => d.close() }, { label: x.confirm, onClick: () => void go() }],
    });
    input.focus();
  };

  /** A new account of the agent `base` runs: named, then signed in at once. @param {AgentRow} base */
  const add = (base) =>
    askName({
      title: `Add a ${base.agentName} account`,
      description: base.style === "key"
        ? "Name it so you can tell it apart — Work, Personal. You sign it in next, on Cursor's page."
        : "Name it so you can tell it apart — Work, Personal. You sign it in next; it keeps a login of its own.",
      confirm: "Add and sign in",
      submit: async (name) => {
        const out = await call("/agent-accounts", { method: "POST", body: { from: base.upstream, name } });
        keeper.keep(out.agent);
        cb.signIn(out.agent.upstream);
      },
    });

  /** @param {AgentRow} r */
  const rename = (r) =>
    askName({
      title: `Rename ${accountName(r)}`,
      description: `The name tells it apart from ${r.agentName}'s other accounts.`,
      value: r.label,
      confirm: "Rename",
      submit: async (name) => {
        const out = await call(`/agent-accounts/${encodeURIComponent(r.upstream)}`, { method: "PATCH", body: { name } });
        keeper.keep(out.agent);
      },
    });

  /** @param {AgentRow} r */
  const remove = async (r) => {
    const yes = await ask({
      title: `Remove ${accountName(r)}?`,
      description: r.style === "key"
        ? "Filament forgets its key. The key stays valid at Cursor until it expires, or until you revoke it in Cursor's dashboard."
        : "Its sign-in on this computer goes with it.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!yes) return;
    busy.add(r.upstream);
    paint();
    try {
      await call(`/agent-accounts/${encodeURIComponent(r.upstream)}`, { method: "DELETE" });
    } catch (e) {
      toast(`Couldn't remove ${accountName(r)}: ${errText(e)}`, "err");
    } finally {
      busy.delete(r.upstream);
      paint();
    }
  };

  /** @param {AgentRow} r */
  const signOut = async (r) => {
    const yes = await ask({
      title: `Sign out of ${accountName(r)}?`,
      description: r.style === "key"
        ? "Filament forgets the key Cursor made for this account. The key stays valid at Cursor until it expires, or until you revoke it in Cursor's dashboard."
        : r.keyKept
          ? "Filament forgets the key it keeps for this account. Sign in takes one again."
          : r.added
            ? "Its sign-in goes from the folder Filament keeps for it. Sign in brings one back."
            : `This signs ${r.agentName} out on this computer — its own CLI too, wherever you use it.`,
      confirmLabel: "Sign out",
      destructive: true,
    });
    if (yes) await word(r, "/sign-out", "Couldn't sign out");
  };

  /** One of a spent plan's reset credits, asked on the app's sheet. @param {AgentRow} r */
  const resetCredit = async (r) => {
    busy.add(r.upstream);
    paint();
    try {
      await cb.useResetCredit(r.upstream);
    } finally {
      busy.delete(r.upstream);
      paint();
    }
  };

  /**
   * One window of an account's plan: its tag and share on a little meter; its name, share and reset in its title. One
   * spent that extra usage covers is amber, and its title says so (`readsAs`).
   * @param {any} w @param {number} t @param {any} a  its account
   */
  const meter = (w, t, a) => {
    const reads = readsAs(a, w);
    const share = w.state === "spent" ? 100 : w.usedPercent == null ? 0 : Math.max(0, Math.min(100, Number(w.usedPercent)));
    const tone = toneOf(reads) ? ` is-${toneOf(reads)}` : "";
    const figure = w.state === "spent" && w.usedPercent == null ? "spent" : percentWords(w);
    return m("span", {
      class: `cag-win${tone}`,
      title: [`${cap(windowName(w))}: ${figure === "—" ? "its share isn't said" : `${figure} used`}`, reads === "covered" ? COVERED : "", resetWords(w.resetsAt, t)].filter(Boolean).join(", "),
    },
      m("span", { class: "cag-win-tag" }, windowTag(w) || cap(windowName(w))),
      m("span", { class: "cag-win-bar", "aria-hidden": "true" }, m("span", { class: "cag-win-fill", style: `width:${share}%` })),
      m("span", {}, figure));
  };

  /**
   * One account: its name and who it runs as, its plan's windows, and what can be done with it — where its agent's
   * program is gone (`gone`), nothing that starts the agent: no sign-in, no check, no sign-out, no reset credit. One
   * someone is signed in to as nobody said whom (`unnamed`: an agent that keeps who it runs as to itself, as
   * Antigravity does) is signed in as one named is — its dot, Sign out, Sign in again — and says so in place of a name.
   * One Filament keeps a pasted key for (`keyKept`) has Sign out whoever is signed in, or nobody, and whether or not
   * its agent signs out itself: it is how the key is forgotten. A key kept that nothing could check says so until
   * something tells who it runs as.
   * @param {AgentRow} r @param {boolean} [gone]
   */
  const accountRow = (r, gone = false) => {
    const t = now();
    const a = r.account;
    const id = whoOf(r);
    const unnamed = !id && signedInUnnamed(a);
    const held = busy.has(r.upstream);
    // A key from outside the account holds who it runs as (HarnessV3-ACP AF1): no Sign in or Sign out here reaches it.
    const fixed = id?.held || null;
    const canSignIn = r.ways.length > 0 && !gone;
    const state = r.off ? "off" : r.signingIn ? "signing" : id || unnamed ? "in" : nobody(r) ? "out" : "unknown";
    const email = id?.email || "";
    const who = r.off
      ? m("span", { class: "cag-who is-quiet" }, "Turned off: Filament doesn't use it. Its sign-in is kept.")
      : r.signingIn
      ? m("span", { class: "cag-who is-signing" }, `Signing in · ${r.signingIn.name}`)
      : id
        ? m("span", { class: "cag-who" },
            m("span", { class: "cag-plan" }, id.label),
            id.organization ? m("span", { class: "cag-org" }, id.organization) : null,
            email ? m("button", {
              class: "cag-email",
              type: "button",
              title: shown.has(r.upstream) ? "Hide the email" : "Show the email",
              "aria-pressed": shown.has(r.upstream) ? "true" : "false",
              onclick: () => {
                if (shown.has(r.upstream)) shown.delete(r.upstream);
                else shown.add(r.upstream);
                paint();
              },
            }, shown.has(r.upstream) ? email : maskEmail(email)) : null)
        : unnamed
          ? m("span", { class: "cag-who" }, r.says === false ? "Signed in. It doesn't say which account" : gone ? "Signed in" : "Signed in: Check now asks it as whom")
          : nobody(r)
            ? m("span", { class: "cag-who is-out" }, "Nobody is signed in")
            : m("span", { class: "cag-who is-quiet" }, r.says === false ? "It doesn't say which account it runs on" : gone ? "Not heard from yet" : "Not heard from yet: Check now asks it");
    const windows = id && a && !r.off ? a.windows.filter((w) => w.state !== "reset") : [];
    const failed = !r.signingIn && r.lastSignIn?.outcome === "failed" ? r.lastSignIn.error : null;
    // An account on an Anthropic API key: the models its key offers beyond its agent's own list, or why Anthropic's
    // list of them could not be asked for — its own list stands either way, so the line is a quiet one.
    const fromKey = r.off ? null : keyWords(r);
    // A pasted key nothing could check, while nothing has said who it runs as: kept, never "signed in".
    const untried = state === "unknown" && r.lastSignIn?.outcome === "key-kept";
    // Where the agent has no sign-in of its own, its CLI's line, to run in a terminal.
    const line = state === "out" && !canSignIn && !gone && r.login
      ? m("div", { class: "cag-line" },
          m("span", {}, "Sign in with its own CLI, then Check now:"),
          m("code", { class: "cag-line-text" }, r.login),
          iconBtn("copy", "Copy the line", () => void copyText(String(r.login)).then(() => toast("The line copied"), () => toast("Copy failed", "err"))))
      : null;
    /** @type {any[]} */
    const items = [
      state === "in" && canSignIn && !fixed ? { label: "Sign in again…", desc: "As someone else, or afresh", onClick: () => cb.signIn(r.upstream) } : null,
      // (the owner's of 11-05) Set aside without signing out: Filament stops using it, and its sign-in stays.
      !gone && state !== "off" && state !== "signing" ? { label: "Turn off", icon: "circleSlash", desc: "Filament stops using it; its sign-in is kept", onClick: () => void word(r, "/off", `Couldn't turn ${accountName(r)} off`) } : null,
      r.added ? { label: "Rename…", onClick: () => rename(r) } : null,
      r.added ? { label: "Remove…", variant: "destructive", onClick: () => void remove(r) } : null,
    ].filter(Boolean);
    /** @type {HTMLElement | null} */
    const more = items.length ? iconBtn("ellipsis", "More", () => openMenu(items, { anchor: /** @type {HTMLElement} */ (more), align: "end", width: 220 }), { disabled: held }) : null;
    // A spent plan that holds a reset credit offers it (HarnessV3-ACP AC3-6): Codex's resets its windows now.
    const credit = state === "in" && !gone && a?.spent && (a.resetCredits?.available || 0) > 0
      ? btn("secondary", "Use a reset credit", () => void resetCredit(r), { disabled: held })
      : null;
    // Sign out where someone is signed in and the agent signs out itself — and wherever Filament keeps a key for it.
    const signOutBtn = (state === "in" ? r.signsOut || r.keyKept : !!r.keyKept) && !gone && !fixed ? btn("secondary", "Sign out", () => void signOut(r), { disabled: held }) : null;
    const acts = state === "off"
      ? [btn("secondary", held ? "Turning on…" : "Turn on", () => void word(r, "/on", `Couldn't turn ${accountName(r)} on`), { disabled: held })]
      : r.signingIn
      ? [btn("default", "Show", () => cb.signIn(r.upstream), { disabled: held }), btn("secondary", "Cancel", () => void word(r, "/sign-in/cancel", "Couldn't cancel the sign-in"), { disabled: held })]
      : state === "out"
        ? [canSignIn ? btn("default", "Sign in", () => cb.signIn(r.upstream), { disabled: held }) : null, signOutBtn]
        : state === "unknown"
          ? [canSignIn ? btn("secondary", "Sign in", () => cb.signIn(r.upstream), { disabled: held }) : null, signOutBtn]
          : [credit, signOutBtn];
    return m("div", { class: `cag-row is-${state}`, "data-upstream": r.upstream },
      m("span", { class: "cag-dot", "aria-hidden": "true" }),
      m("div", { class: "cag-main" },
        m("div", { class: "cag-top" }, m("span", { class: "cag-label" }, r.label), who),
        windows.length || a?.at
          ? m("div", { class: "cag-wins" },
              ...windows.map((w) => meter(w, t, a)),
              id && !windows.length && a?.noWindows ? m("span", { class: "cag-quiet" }, a.noWindows) : null,
              a?.at ? m("span", { class: "cag-age" }, `Updated ${ago(a.at, t)}`) : null)
          : null,
        fixed ? m("div", { class: "cag-held" }, fixed) : null,
        fromKey ? m("div", { class: "cag-quiet cag-key" }, fromKey) : null,
        untried ? m("div", { class: "cag-held" }, "Key kept; its next turn tries it.") : null,
        failed ? m("div", { class: "cag-failed" }, `The last sign-in didn't finish: ${failed}.`) : null,
        line),
      m("div", { class: "cag-acts" },
        ...acts,
        gone || state === "off" ? null : iconBtn("refreshCw", held ? "Checking…" : checkWords(r), () => void check(r), { disabled: held, cls: held ? "is-busy" : "" }),
        more));
  };

  /** @param {AgentRow} r */
  const check = async (r) => {
    busy.add(r.upstream);
    paint();
    try {
      await keeper.check(r.upstream);
    } finally {
      busy.delete(r.upstream);
      paint();
    }
  };

  // ---- an agent -----------------------------------------------------------------------------------------------------

  /**
   * Ask of an agent through its route; the entries as they then stand replace the page's copy, a refusal is said.
   * @param {CodingAgent} e @param {"connect" | "off" | "models"} what @param {string} failed @param {string} [done]  said once it's done
   */
  const agentWord = async (e, what, failed, done) => {
    working.add(e.id);
    paint();
    try {
      agents.keep(await call(`/coding-agents/${encodeURIComponent(e.id)}/${what}`, { method: "POST" }));
      if (done) toast(done);
    } catch (err) {
      toast(`${failed}: ${errText(err)}`, "err");
    } finally {
      working.delete(e.id);
      paint();
    }
  };

  /** An agent Filament installed, removed from this computer once the person says so. @param {CodingAgent} e */
  const removeAgent = async (e) => {
    const yes = await ask({
      title: `Remove ${e.name} from this computer?`,
      description: "Filament deletes the copy it installed, and forgets its accounts and its models. Your chats with it stay.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!yes) return;
    working.add(e.id);
    paint();
    try {
      const out = await call(`/coding-agents/${encodeURIComponent(e.id)}`, { method: "DELETE" });
      agents.keep(out);
      toast(out?.kept ? `${e.name} is removed; ${out.kept}` : `${e.name} is removed from this computer`);
    } catch (err) {
      toast(`Couldn't remove ${e.name}: ${errText(err)}`, "err");
    } finally {
      working.delete(e.id);
      paint();
    }
  };

  /** ACP's registry read again now. */
  const refreshRegistry = async () => {
    try {
      agents.keep(await call("/coding-agents/registry/refresh", { method: "POST" }));
    } catch (err) {
      toast(`Couldn't read ACP's registry: ${errText(err)}`, "err");
    }
  };

  /**
   * What brings an agent's program to this computer, or connects it: the one thing its row offers.
   * @param {CodingAgent} e
   */
  const getIt = (e) =>
    e.install?.needs
      ? linkBtn(`Needs ${e.install.needs}`, NEEDS_PAGE[e.install.needs], `${e.name} installs with ${e.install.needs}: get it first`)
      : e.install
        ? btn("secondary", "Install…", () => cb.install(e.id))
        : e.download
          ? linkBtn("Download", e.download.url, `Download ${e.name} for this computer, from its maker`)
          : null;

  /** What an agent does in a chat, and its models. @param {CodingAgent} e */
  const facts = (e) => {
    const chips = e.profile ? supportsRows(e.profile).filter((x) => x.has && FELT.has(x.key)) : [];
    const t = now();
    const held = working.has(e.id);
    const words = e.asking
      ? "Asking for its models…"
      : e.modelsError
        ? `It couldn't list its models: ${e.modelsError}`
        : e.models
          ? `${e.models.count ? modelCount(e.models.count) : "No models listed"} · ${ago(e.models.at, t)}`
          : "No model list yet";
    return m("div", { class: "cag-facts" },
      chips.length
        ? m("div", { class: "cag-chips", role: "list", "aria-label": "What it does in a chat" },
            ...chips.map((c) => m("span", { class: "cag-chip", role: "listitem", title: c.means }, c.word)))
        : null,
      m("div", { class: `cag-models${e.modelsError ? " is-error" : ""}` },
        m("span", {}, words),
        iconBtn("refreshCw", e.asking ? "Asking for its models…" : "Ask for its models again", () => void agentWord(e, "models", `Couldn't ask ${e.name} for its models`), {
          disabled: e.asking || held,
          cls: e.asking ? "is-busy" : "",
        })));
  };

  /** The providers as the models folds read and change them; read the first time a fold opens. @type {ReturnType<typeof providersState> | null} */
  let models = null;
  /** Each agent's models fold, kept across paints: its rows are built the first time it opens. @type {Map<string, { det: any, note: any }>} */
  const folds = new Map();
  /**
   * An agent's models (HarnessV4_Settings_Plan HS-D12, HC-49): the rows a provider's page shows — in the picker or not,
   * add one by name, tune it — for the account its models line reads.
   * @param {CodingAgent} e
   */
  const modelsFold = (e) => {
    if (!e.primary) return null;
    const key = `${e.id}|${e.primary}`;
    let got = folds.get(key);
    if (!got) {
      const note = m("p", { class: "cag-mrows-note" });
      /** @type {any} */
      let part = null;
      const det = /** @type {any} */ (m("details", { class: "cag-mrows" }, m("summary", {}, "Models: in the picker or not, add one by name, tune one"), note));
      det.ontoggle = () => {
        if (!det.open || part) return;
        models ||= providersState(call, subscribe);
        part = createModelRows({ state: models, id: String(e.primary), onToast: toast, subscribe, now }, { h: m, api: call, dialog: openDialog, confirm: ask });
        det.append(part.el);
        void models.read();
      };
      got = { det, note };
      folds.set(key, got);
    }
    // Its Default turned off by itself: the account its models line reads now.
    got.note.replaceChildren(e.upstreams.length < 2 ? "" : e.primary === e.id ? "Its Default account's models. An account added starts from this list and keeps its own." : "The models of the account it runs on, its Default turned off. Each account keeps its own list.");
    return got.det;
  };

  /**
   * The agent's menu: its version — Filament's install of it, or the one npm installed here — and its Update, its docs,
   * Turn off, Remove.
   * @param {CodingAgent} e
   */
  const agentMenu = (e) => {
    const on = e.state === "connected";
    /** @type {any[]} */
    const items = [
      e.installed ? { type: "label", label: `Installed by Filament · ${e.installed.version}` } : e.runs ? { type: "label", label: `Version ${e.runs}` } : null,
      on && e.update && e.install && !e.install.needs && !e.installing
        ? { label: `Update to ${e.update}…`, icon: "download", onClick: () => cb.install(e.id) }
        : null,
      e.docs ? { label: "Its website", icon: "externalLink", onClick: () => openPage(String(e.docs)) } : null,
      on ? { label: "Turn off", icon: "circleSlash", desc: e.retired?.leaves ? "It leaves your settings the next time Filament starts" : "Its accounts and their logins are kept", onClick: () => void agentWord(e, "off", `Couldn't turn ${e.name} off`, `${e.name} is turned off`) } : null,
      e.installed ? { type: "separator" } : null,
      e.installed ? { label: "Remove from this computer…", icon: "trash2", variant: "destructive", onClick: () => void removeAgent(e) } : null,
    ].filter(Boolean);
    if (!items.length) return null;
    /** @type {HTMLElement} */
    const el = iconBtn("ellipsis", `More for ${e.name}`, () => openMenu(items, { anchor: el, align: "end", width: 260 }), { disabled: working.has(e.id) });
    return el;
  };

  /**
   * An agent connected, or turned off: its card. A turned-off one is short — its name, that its accounts are kept,
   * and Turn on. One Filament drives no more says so on both, with what becomes of its connection (`retiredWords`).
   * @param {CodingAgent} e @param {AgentRow[]} rows
   */
  const card = (e, rows) => {
    const held = working.has(e.id);
    const retired = retiredWords(e);
    if (e.state === "off")
      return m("section", { class: "cag-card is-off", "data-agent": e.id },
        m("div", { class: "cag-head" },
          markTile(m, e),
          m("div", { class: "cag-head-text" },
            m("h3", { class: "cag-name" }, e.name),
            m("p", { class: "cag-style" }, retired ? `Turned off. ${retired}` : "Turned off — its accounts and their logins are kept.")),
          m("div", { class: "cag-head-acts" },
            btn("secondary", held ? "Turning on…" : "Turn on", () => void agentWord(e, "connect", `Couldn't turn ${e.name} on`, `${e.name} is on again`), { disabled: held }),
            agentMenu(e))));
    const base = rows[0] || null;
    // An update replaces a version that is here: Filament's install of it, or one the registry has a newer one of.
    const updating = !!(e.installed || e.update);
    const update = e.installing
      ? m("div", { class: "cag-note" }, spinning(updating ? `Updating to ${e.installing.version || e.update}…` : "Installing…"), btn("secondary", "Show", () => cb.install(e.id)))
      : e.lastInstall?.outcome === "failed"
        ? m("p", { class: "cag-failed" }, `The last ${updating ? "update" : "install"} didn't finish: ${e.lastInstall.error || "it ended early"}.`)
        : null;
    return m("section", { class: "cag-card", "data-agent": e.id },
      m("div", { class: "cag-head" },
        markTile(m, e),
        m("div", { class: "cag-head-text" },
          m("h3", { class: "cag-name" }, e.name),
          base ? m("p", { class: "cag-style" }, styleWords(base)) : null),
        m("div", { class: "cag-head-acts" }, base?.style ? btn("secondary", "Add account", () => add(base)) : null, agentMenu(e))),
      facts(e),
      retired ? m("div", { class: "cag-callout", role: "note" }, m("span", {}, retired)) : null,
      e.gone && !e.installing
        ? m("div", { class: "cag-callout", role: "note" }, m("span", {}, `${e.name}'s program isn't on this computer any more: its turns can't start.`), getIt(e))
        : null,
      // Older than the version Filament holds it to (Antigravity before 1.5.1): why, with its Update at hand — or why
      // there's none yet, its maker's feed unread.
      e.outdated && !e.installing && !e.gone
        ? m("div", { class: "cag-callout", role: "note" },
            m("span", {}, e.waiting && !e.update ? `${e.outdated}. ${e.waiting}.` : `${e.outdated}.`),
            e.update && e.install && !e.install.needs ? btn("secondary", held ? "Updating…" : `Update to ${e.update}`, () => cb.install(e.id), { disabled: held }) : null)
        : null,
      update,
      rows.length ? m("div", { class: "cag-rows" }, ...rows.map((r) => accountRow(r, e.gone))) : null,
      modelsFold(e));
  };

  /** An agent to add: what it is, who makes it, how it installs, and the one thing it offers. @param {CodingAgent} e */
  const item = (e) => {
    const held = working.has(e.id);
    const about = retiredWords(e) || e.about;
    const failed = !e.installing && e.lastInstall?.outcome === "failed" ? e.lastInstall.error || "it ended early" : null;
    const act = e.installing
      ? [spinning("Installing…"), btn("secondary", "Show", () => cb.install(e.id))]
      : e.state === "ready"
        ? btn("secondary", held ? "Connecting…" : "Connect", () => void agentWord(e, "connect", `Couldn't connect ${e.name}`, `${e.name} is connected`), { disabled: held })
        : getIt(e) || m("span", { class: "cag-quiet", ...(e.waiting ? { title: e.waiting } : {}) }, e.waiting ? "Waiting for Google's release feed" : e.unavailable ? "Not made for this computer" : "Not on this computer");
    return m("div", { class: "cag-item", "data-agent": e.id },
      markTile(m, e),
      m("div", { class: "cag-item-main" },
        m("div", { class: "cag-item-top" },
          m("span", { class: "cag-item-name" }, e.name),
          e.version ? m("span", { class: "cag-item-ver" }, e.version) : null),
        about ? m("p", { class: `cag-item-about${e.retired ? " is-whole" : ""}`, title: about }, about) : null,
        m("p", { class: "cag-item-meta" }, [makerWords(e), installWords(e)].filter(Boolean).join(" · ")),
        e.state === "missing" && e.download && !e.install
          ? m("p", { class: "cag-item-hint" }, "Connect shows here once ", m("code", {}, e.download.program), " is on your PATH.")
          : null,
        failed ? m("p", { class: "cag-failed" }, `The last install didn't finish: ${failed}.`) : null),
      m("div", { class: "cag-item-act" }, act));
  };

  /** The registry's line: where the list below comes from, how old it is, Refresh, and why the last read failed. @param {CodingAgents["registry"]} r */
  const registryLine = (r) =>
    m("div", { class: "cag-reg" },
      m("span", { class: "cag-reg-from" }, "From ACP's registry"),
      r.asking ? spinning(r.at ? "Updating…" : "Reading…") : r.at ? m("span", { class: "cag-reg-age" }, `updated ${ago(r.at, now())}`) : null,
      r.asking ? null : m("button", { class: "cag-reg-refresh", type: "button", onclick: () => void refreshRegistry() }, "Refresh"),
      r.error && !r.asking ? m("span", { class: "cag-reg-error" }, `${r.at ? "The last read failed" : "It couldn't be read"}: ${r.error}.`) : null);

  // ---- the section --------------------------------------------------------------------------------------------------

  const yoursCount = m("span", { class: "cag-n" });
  const yoursList = m("div", { class: "cag-list" });
  const search = /** @type {HTMLInputElement} */ (m("input", {
    class: "zc-input cag-search", type: "search", placeholder: "Search agents", "aria-label": "Search the coding agents",
    spellcheck: "false", autocomplete: "off",
  }));
  search.addEventListener("input", () => {
    query = String(search.value || "");
    paint();
  });
  const addList = m("div", { class: "cag-adds" });
  const root = m("div", { class: "cag-page" },
    m("p", { class: "imp-pointer" }, "Chats you had in these agents outside Filament come in through ", m("a", { href: routeFor("settings", { section: "import" }) }, "Settings › Import"), "."),
    m("section", { class: "cag-sec" }, m("div", { class: "cag-sec-head" }, m("h3", { class: "cag-h" }, "Your agents", yoursCount)), yoursList),
    m("section", { class: "cag-sec" }, m("div", { class: "cag-sec-head" }, m("h3", { class: "cag-h" }, "Add a coding agent"), search), addList));

  /** What was painted last: a read that changes nothing here paints nothing. */
  let painted = "";
  function paint() {
    if (menusOn.size) return;
    const list = agents.now();
    const rows = keeper.rows();
    const key = JSON.stringify([list, rows, [...busy], [...working], [...shown], query, Math.floor(now() / 60_000)]);
    if (key === painted) return;
    painted = key;
    if (!list) {
      yoursCount.replaceChildren();
      yoursList.replaceChildren(spinning("Reading your agents…"));
      addList.replaceChildren();
      return;
    }
    // An account goes on its agent's card: Default first, then the ones added, by name.
    const mine = list.entries.filter((e) => e.state === "connected" || e.state === "off");
    const cards = [...mine.filter((e) => e.state === "connected"), ...mine.filter((e) => e.state === "off")].map((e) =>
      card(e, rows.filter((r) => e.upstreams.includes(r.upstream)).sort((x, y) => Number(x.added) - Number(y.added) || x.label.localeCompare(y.label))));
    yoursCount.replaceChildren(mine.length ? String(mine.length) : "");
    yoursList.replaceChildren(...(cards.length ? cards : [m("p", { class: "cag-empty" }, "No coding agent is connected yet. Connect one below.")]));
    const q = query.trim();
    const offered = list.entries.filter((e) => (e.state === "ready" || e.state === "missing") && (!q || matches(e, q)));
    const known = offered.filter((e) => e.from !== "registry");
    const listed = offered.filter((e) => e.from === "registry");
    addList.replaceChildren(...[
      known.length ? m("div", { class: "cag-group" }, ...known.map(item)) : null,
      registryLine(list.registry),
      listed.length ? m("div", { class: "cag-group" }, ...listed.map(item)) : null,
      q && !offered.length ? m("p", { class: "cag-none" }, `No agent to add matches “${q}”.`) : null,
    ].filter(Boolean));
  }

  body.replaceChildren(root);
  paint();
  // Each new read of the agents or their accounts is drawn while the section shows; a section left lets go of both.
  /** @type {(() => void)[]} */
  const offs = [];
  const drawn = () => (root.isConnected === false ? offs.forEach((off) => off()) : paint());
  offs.push(keeper.listen(drawn), agents.listen(drawn));
}
