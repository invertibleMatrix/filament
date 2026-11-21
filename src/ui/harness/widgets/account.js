// @ts-check
// The Account instrument (HarnessV3-ACP AC3-6): whose plan a coding agent's turns spend and how much of it is left, as
// the agent itself says it — Claude's sign-in and the windows its turns report, Codex's account and its rate limits,
// the owner of Cursor's key. Its pill stands in the typing row before the context ring, whenever the model chosen is
// a coding agent's: a half-ring gauge for the fullest window — grey, amber from 80 % or where extra usage covers a spent
// one, red when spent (`readsAs`) — with the window's tag and its share ("5h 42%"); the person's glyph alone where the
// agent has no windows to show (an API key, Cursor). The popover names the account, its email masked until clicked; draws each window as a level meter with its
// reset and its pace; says the extra usage, the credits and the reset credits; and offers Check now, a Codex reset
// credit while the plan is spent, and Settings → Coding agents. Where nobody is signed in it offers Sign in, and a
// sign-in under way, Show (HarnessV3-ACP AC3-7); the agent's other accounts are listed to switch the session to, each
// with its gauge — one nobody is signed in to is signed in first — and Check now asks them too. The rows are the
// page's (`ctx.accounts`): a widget never fetches.
import { h, morphChildren } from "../../lib/dom.js";
import { accountName, cap, checkWords, coveredWords, extraWords, freeWords, fullestOf, gaugeOf, glanceOf, maskEmail, notYetWords, othersOf, paceWords, percentWords, planTag, reachedWords, readsAs, resetWords, signedInUnnamed, summaryWords, toneOf, whenWords, windowName } from "../../lib/accounts.js";
import { actions, ago, gaugeSvg, group, head, icon, inlineMarks, kids, link, note, row, section, stackBar, stateColor } from "./kit.js";

/** @typedef {import("../../lib/accounts.js").AgentRow} AgentRow */
/** @typedef {import("../../lib/accounts.js").WindowView} WindowView */

/**
 * @param {import("./registry.js").WidgetContext} ctx
 * @param {import("./frame.js").WidgetIO} [io]
 * @param {{ now?: () => number }} [o]  the tests' clock
 * @returns {import("./frame.js").WidgetSpec}
 */
export function accountWidget(ctx, io = {}, o = {}) {
  const mk = io.h || h;
  // The open popover is drawn again at every word of the accounts and of the chat's agents: in place, Check now, the
  // email and each account to switch to the elements that stood under the pointer (the owner's of 11-01: buttons
  // blinking under a resting pointer, clicks lost).
  const drawIn = io.drawIn || morphChildren;
  const now = o.now || Date.now;
  const agent = () => ctx.accounts.session();
  const account = () => agent()?.account || null;
  const fullest = () => fullestOf(account());
  /** The agent said who it runs as, and that its plan has no windows to show (an API key, Cursor). */
  const windowless = () => {
    const a = account();
    return !!a?.identity && !a.signedOut && !a.windows.length && !!a.noWindows;
  };
  const glance = () => glanceOf(account());
  /**
   * The pill's words: the fullest window's tag and share, or what stopped the plan; where no share is said (before
   * Claude's first `/usage` is read, Check now's or a turn's end's — its rate-limit info says one only as a window nears
   * its end), the plan's name, which says whose turns these are (HarnessV3-ACP, AC3's drive D4).
   * @returns {[string, string]}
   */
  const faceWords = () => {
    const g = glance();
    return g.figure ? [g.tag, g.figure] : ["", planTag(account()?.identity)];
  };

  /** @type {null | (() => void)} the open popover's parts, drawn again */
  let painter = null;
  /** Whether the tile's Check now is on its way. */
  let tileChecking = false;

  /** @param {typeof h} m @param {() => void} close @param {() => void} [relayout] */
  const panel = (m, close, relayout) => {
    // The email stays masked until asked for, each time the popover opens.
    let shown = false;
    let checking = false;
    const headBox = m("div", {});
    const body = m("div", { class: "inst-account-body" });
    const actBox = m("div", { class: "inst-account-actions" });
    const foot = m("span", { class: "inst-foot-note" });
    /** One window as a level meter: its name and share, the bar, its reset and pace. @param {WindowView} w @param {number} t */
    const meter = (w, t) => {
      const reads = readsAs(account(), w);
      const known = w.state === "spent" || (w.state !== "reset" && w.usedPercent != null);
      const figure = w.state === "reset" ? "—" : w.state === "spent" && w.usedPercent == null ? "Spent" : percentWords(w);
      const caption = w.state === "reset"
        ? `Reset${w.resetsAt != null ? ` ${whenWords(w.resetsAt, t)}` : ""} — its new period shows once the agent reports it`
        : [cap(resetWords(w.resetsAt, t)), paceWords(w, t)].filter(Boolean).join(" · ");
      return m("div", { class: "inst-meter" },
        m("div", { class: "inst-card-head" },
          m("span", { class: "inst-card-title" }, cap(windowName(w))),
          m("span", { class: `inst-card-fig${toneOf(reads) ? ` is-${toneOf(reads)}` : ""}` }, figure)),
        stackBar(m, known ? [{ value: w.state === "spent" ? 100 : Number(w.usedPercent), color: stateColor(reads, "var(--accent)"), label: cap(windowName(w)) }] : [], { total: 100 }),
        caption ? m("div", { class: "inst-meter-cap" }, caption) : null);
    };
    painter = () => {
      const r = agent();
      const a = account();
      const t = now();
      const id = a?.identity && !a.signedOut ? a.identity : null;
      const email = id?.email || "";
      drawIn(headBox, [head(m, {
        icon: "user",
        title: id ? id.label : r?.name || "Account",
        sub: kids([
          id ? r?.name : "",
          id?.organization ? ` · ${id.organization}` : "",
          email ? " · " : "",
          email
            ? m("button", {
                class: "inst-email",
                type: "button",
                title: shown ? "Hide the email" : "Show the email",
                "aria-pressed": shown ? "true" : "false",
                onclick: () => { shown = !shown; painter?.(); },
              }, shown ? email : maskEmail(email))
            : "",
          !email && id?.detail && id.kind !== "api-key" ? ` · ${id.detail}` : "",
        ]),
      })]);
      // A spent window extra usage covers stops nothing (`readsAs`): it is said in amber, with no "free again".
      const spentWindow = a?.windows.some((w) => readsAs(a, w) === "spent");
      // An agent with a sign-in of its own signs in on the app's sheet; one without names its CLI's line.
      const signs = !!r && r.ways.length > 0;
      /** @type {[string, "" | "warn" | "error"] | null} the one sentence the account calls for, and its tone */
      const said = !r ? null
        : r.signingIn ? [`Signing in through ${r.signingIn.name}: Show brings the sign-in back.`, ""]
        : signedInUnnamed(a) ? [`${r.name} is signed in, and hasn't said which account it runs on yet. ${r.type === "acp" ? "It says when it starts: Check now starts it." : "Check now asks it."}`, ""]
        : !a?.identity ? [`${r.name} hasn't said which account it runs on yet. ${r.type === "acp" ? "It says when it starts: Check now starts it." : "Check now asks it."}`, ""]
        : a.signedOut ? [signs ? "Nobody is signed in." : r.login ? `Nobody is signed in. Run \`${r.login}\` in a terminal, then Check now.` : "Nobody is signed in: sign in with the agent's own command, then Check now.", "error"]
        : spentWindow ? [freeWords(a.freeAt, t) || (a.freeAt != null ? "It has reset since: Check now reads its new period." : "It doesn't say when it's free again."), "error"]
        : a.spent ? [reachedWords(a.reached) || "Codex says the plan has reached its limit.", "error"]
        : coveredWords(a) ? [coveredWords(a), "warn"]
        : id?.held ? [id.held, ""]
        : !a.windows.length ? [a.noWindows || notYetWords(r), ""]
        : null;
      const rows = !id || !a ? [] : kids([
        a.extra ? (() => {
          const [value, sub] = extraWords(/** @type {any} */ (a.extra), t);
          return row(m, { label: "Extra usage", value, sub });
        })() : null,
        a.credits ? row(m, { label: "Credits", value: a.credits.unlimited ? "Unlimited" : a.credits.has ? a.credits.balance || "Some" : "None" }) : null,
        a.resetCredits ? row(m, {
          label: "Reset credits",
          value: String(a.resetCredits.available),
          sub: a.resetCredits.nextExpiresAt != null ? `The next one expires ${whenWords(a.resetCredits.nextExpiresAt, t)}` : "",
        }) : null,
      ]);
      // The agent's other accounts, kept the same way, to switch the session to: each with its gauge (the person's
      // glyph where there's nothing to gauge) and its glance. One nobody is signed in to signs in first, on the sheet,
      // which then offers the switch; where it has no sign-in of its own, it waits for its CLI's.
      const others = r ? othersOf(ctx.accounts.rows(), r) : [];
      drawIn(body, kids([
        id && a?.windows.length ? m("div", { class: "inst-card inst-meters" }, ...a.windows.map((w) => meter(w, t))) : null,
        rows.length ? group(m, ...rows) : null,
        said ? note(m, inlineMarks(m, said[0]), said[1]) : null,
        others.length ? section(m, "Switch account", group(m, ...others.map((x) => {
          const g = glanceOf(x.account);
          const out = !!x.account?.signedOut;
          const signsFirst = out && x.ways.length > 0;
          const who = x.account?.identity && !out ? x.account.identity.label : out ? "Nobody is signed in" : signedInUnnamed(x.account) ? "Signed in" : "Not heard from yet";
          const f = gaugeOf(x.account);
          return m("button", {
            class: "inst-row is-button",
            type: "button",
            "data-key": x.upstream,
            ...(out && !signsFirst ? { disabled: "" } : {}),
            title: signsFirst
              ? `Sign ${accountName(x)} in; then the session's next turn can run on it`
              : out ? summaryWords(x, t) : `${summaryWords(x, t)}\nThe session's next turn runs on it`,
            onclick: () => {
              close();
              if (signsFirst) ctx.accounts.signIn(x.upstream, { label: "Switch to it", run: () => ctx.accounts.switchTo(x.upstream) });
              else ctx.accounts.switchTo(x.upstream);
            },
          },
            f == null
              ? icon(m, "user", "inst-switch-glyph")
              : m("span", { class: "inst-switch-gauge", html: gaugeSvg({ width: 16, stroke: 2.4, f, color: stateColor(readsAs(x.account, fullestOf(x.account)), "var(--color-sys-gray)") }) }),
            m("span", { class: "inst-row-text" }, m("span", { class: "inst-row-label" }, x.label), m("span", { class: "inst-row-sub" }, who)),
            signsFirst ? m("span", { class: "inst-switch-fig is-act" }, "Sign in")
              : g.figure && !out ? m("span", { class: `inst-switch-fig${g.tone ? ` is-${g.tone}` : ""}` }, [g.tag, g.figure].filter(Boolean).join(" ")) : null);
        }))) : null,
      ]));
      const resettable = !!r && r.type === "codex" && !!a?.spent && (a.resetCredits?.available || 0) > 0;
      drawIn(actBox, kids([actions(m, [
        r && r.signingIn ? { label: "Show", icon: "user", primary: true, title: `Bring back ${accountName(r)}'s sign-in`, onClick: () => { close(); ctx.accounts.signIn(r.upstream); } } : null,
        r && !r.signingIn && signs && a?.signedOut ? { label: "Sign in", icon: "user", primary: true, title: `Sign ${accountName(r)} in`, onClick: () => { close(); ctx.accounts.signIn(r.upstream); } } : null,
        r ? { label: checking ? "Checking…" : "Check now", icon: "refreshCw", title: `${checkWords(r)}${others.length ? `\nEach of its ${others.length + 1} accounts is asked` : ""}`, disabled: checking, onClick: () => {
          checking = true;
          painter?.();
          ctx.accounts.check(r.upstream).finally(() => { checking = false; painter?.(); });
        } } : null,
        resettable && r ? { label: "Use a reset credit", icon: "rotateCcw", primary: true, title: "Reset the plan's windows now with one of Codex's reset credits", onClick: () => { close(); ctx.accounts.useResetCredit(r.upstream); } } : null,
      ])]));
      drawIn(foot, [a?.at ? `Updated ${ago(a.at, t)}` : "Not heard from yet"]);
      relayout?.();
    };
    painter();
    return m("div", { class: "inst inst-account" }, headBox, body, actBox,
      m("div", { class: "inst-foot" }, foot, link(m, "Accounts", () => { close(); ctx.accounts.manage(); })));
  };

  return {
    id: "account",
    label: "Account",
    tileIcon: "user",
    width: 320,
    // The tile on Overview (proposal_ux §4.6, M): the plan's windows, each a level meter with its share and its reset,
    // and Check now at its head — a read of the account, which never spends. Where the chat's model is no coding
    // agent's, the tile stays and says why it has nothing to show (§5.5: no widget is removed for an engine).
    tileSub: () => {
      const r = agent();
      const id = account()?.identity;
      return r ? [r.agentName, planTag(id), id && !account()?.signedOut ? id.label : ""].filter(Boolean).join(" · ") : "";
    },
    tileTrail: (m) => {
      const r = agent();
      if (!r) return null;
      return m("button", {
        class: "ov-tile-act",
        type: "button",
        title: checkWords(r),
        ...(tileChecking ? { disabled: "" } : {}),
        onclick: (/** @type {Event} */ e) => {
          e.stopPropagation();
          tileChecking = true;
          /** @type {HTMLButtonElement} */ (e.currentTarget).disabled = true;
          ctx.accounts.check(r.upstream).finally(() => { tileChecking = false; });
        },
      }, icon(m, "refreshCw"), tileChecking ? "Checking…" : "Check now");
    },
    tile: (m) => {
      const r = agent();
      const a = account();
      const t = now();
      if (!r) return [m("p", { class: "ov-greyed" }, "The chat's model runs on your providers, which bill each request: there is no plan with windows to watch. Spend says what it cost.")];
      if (!a?.identity) return [m("p", { class: "ov-line" }, signedInUnnamed(a) ? `${r.name} is signed in, and hasn't said which account it runs on yet.` : `${r.name} hasn't said which account it runs on yet.`)];
      if (a.signedOut) return [m("p", { class: "ov-line is-error" }, "Nobody is signed in."), m("p", { class: "ov-quiet" }, "Press the tile to sign in.")];
      if (!a.windows.length) return [m("p", { class: "ov-line" }, a.noWindows || notYetWords(r))];
      // Two fit on the tile (§5.3): the most used, in the account's own order; the popover has every one.
      const used = (/** @type {any} */ w) => (w.state === "spent" ? 101 : Number(w.usedPercent) || 0);
      const kept = new Set([...a.windows].sort((x, y) => used(y) - used(x)).slice(0, 2));
      return a.windows.filter((w) => kept.has(w)).map((w) => {
        const tone = toneOf(readsAs(a, w)) ? `is-${toneOf(readsAs(a, w))}` : "";
        return m("div", { class: "ov-window" },
          m("div", { class: "ov-window-line" },
            m("span", {}, cap(windowName(w))),
            m("span", { class: "ov-window-fig" }, m("b", { class: tone }, w.state === "reset" ? "—" : w.state === "spent" && w.usedPercent == null ? "Spent" : percentWords(w)), w.resetsAt != null ? ` · ${resetWords(w.resetsAt, t)}` : "")),
          m("div", { class: "ov-meter" }, m("span", { class: `ov-meter-fill ${tone || "is-cyan"}`, style: `width:${w.state === "spent" ? 100 : Math.max(0, Math.min(100, Number(w.usedPercent) || 0))}%` })));
      });
    },
    // In a coding agent's session, once its agent is known to say who it runs as (an ACP agent tells at its start).
    visible: () => {
      const r = agent();
      return !!r && r.says !== false && (r.says === true || !!r.account);
    },
    state: () => faceWords().filter(Boolean).join(" "),
    tone: () => glance().tone,
    title: () => {
      const r = agent();
      return r ? summaryWords(r, now()) : "";
    },
    // Hollow: a gauge with nothing to read yet (no window, or no share said); the glyph needs no mark.
    marks: () => ({ hollow: !windowless() && gaugeOf(account()) == null }),
    face: (m) => {
      if (windowless()) return m("span", { class: "inst-face" }, icon(m, "user", "inst-face-glyph"));
      const [tag, figure] = faceWords();
      return m("span", { class: "inst-face" },
        m("span", { class: "inst-face-gauge", html: gaugeSvg({ width: 18, stroke: 2.6, f: gaugeOf(account()), color: stateColor(readsAs(account(), fullest()), "var(--color-sys-gray)") }) }),
        figure ? m("span", { class: "inst-face-text" }, tag ? m("span", { class: "inst-face-tag" }, tag) : null, figure) : null);
    },
    panel,
    repaint: () => painter?.(),
  };
}
