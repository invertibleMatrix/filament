// @ts-check
// Add a connector (the owner's word of 10-26: "some well know connectors like github, linear … should be easy like
// Claude code to add. Not everyone have url and command to know"; the Designer's of 10-26): the Add connector sheet's
// first step in Library › Plugins & Connectors and a Space's Connectors. The connectors the marketplaces Filament reads list —
// Claude Code's, Codex's, those you added (app/connector-catalogue.js) —, searched by name: those Claude Code has
// installed, then the online services, then the tools that run on this computer, A–Z in each; a row each with its
// words on one line, what a person must bring (a value, a program this computer lacks) and Add — the rest, where it
// connects or what it runs, on its title's hover (the Designer's of 10-26). Add installs its plugin and turns it on for the place; the same sheet then finishes it — a token it
// needs, saved sealed and tested; a sign-in on its site, waited on as the list's row follows it; a test of one that
// runs here. A plugin that brings more than a connector opens its plugin's sheet instead (Add…). With no marketplace on
// this computer, one press fetches Anthropic's. "Not listed? Set one up by hand…" opens the hand-made form. "Finish
// setup…" on a row that waits, in any list, opens the second step alone for the place its plugin is on. Built with an
// injected `h`, `api`, dialog, plugin sheet and timer, so it runs on the fake DOM; the pure helpers under it are what
// the tests read the words from.
import { h } from "../../lib/dom.js";
import { api } from "./api.js";
import { ICONS } from "./icons.js";
import { dialog } from "./ui.js";
import { pluginSheet } from "../library/plugin-sheet.js";

/** @param {unknown} e */
const errText = (e) => String(/** @type {any} */ (e)?.message || e);
/** "A", "A and B", "A, B and C". @param {readonly string[]} xs */
const listWords = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
/** A count with its noun: "a hook", "2 skills". @param {number} n @param {string} one @param {string} many */
const counted = (n, one, many) => (n === 1 ? one : `${n} ${many}`);

/** The search's placeholder, and the sheet's way to the hand-made form. */
export const SEARCH_HINT = "Search by name, like GitHub or Linear";
export const BY_HAND = "Not listed? Set one up by hand…";
/** With no marketplace on this computer. */
export const NO_LIST = "Filament has no list yet of what you can connect — GitHub, Linear and more.";
export const NO_LIST_QUIET = "Get the list downloads it once from Anthropic's GitHub: the list Claude Code uses. Nothing is connected until you press Add.";
/** The button that downloads it. */
export const GET_LIST = "Get the list";
/** Under a token's field. */
export const SEALED = "Kept on this computer, sealed; agents never see it.";

/** A value's title as a line says it: "Personal access token" → "personal access token"; "API key" stays. @param {string} t */
const lowered = (t) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
/** "a personal access token", "an API key". @param {string} t */
const withArticle = (t) => `${/^[aeiou]/i.test(t) && !/^U[A-Z]/.test(t) ? "an" : "a"} ${t}`;

/**
 * Where a connector's servers connect, or what they run. @param {{ servers: { remote: boolean, host: string, runs: string }[] }} row
 */
export function serverWords(row) {
  // A host a value you give makes is said so.
  const remote = row.servers.filter((s) => s.remote).map((s) => s.host || "an address you give");
  const local = row.servers.filter((s) => !s.remote).map((s) => s.runs);
  return [remote.length ? `Connects to ${listWords([...new Set(remote)])}` : "", local.length ? `Runs on this computer: ${local.join("; ")}` : ""].filter(Boolean).join(" · ");
}

/**
 * What a person must bring before it works (the Designer's of 10-26), "" for nothing: a program it runs that this
 * computer lacks, and the values it needs — "Needs a personal access token", "Needs PHP (not found on this computer)
 * and a tfe token", "Needs 3 values".
 * @param {readonly string[]} needs @param {readonly string[]} [programs]  those not found here
 */
export function needWords(needs, programs = []) {
  const values = needs.length > 2 ? [`${needs.length} values`] : needs.map((t) => withArticle(lowered(t)));
  const parts = [...[...new Set(programs)].map((p) => `${p} (not found on this computer)`), ...values];
  return parts.length ? `Needs ${listWords(parts)}` : "";
}

/** What else its plugin adds: "also adds 2 skills and a hook". @param {{ skills: number, hooks: number, commands: number, agents: number }} more */
export function moreWords(more) {
  const parts = [
    more.skills ? counted(more.skills, "a skill", "skills") : "",
    more.hooks ? counted(more.hooks, "a hook", "hooks") : "",
    more.commands ? counted(more.commands, "a command", "commands") : "",
    more.agents ? counted(more.agents, "an agent", "agents") : "",
  ].filter(Boolean);
  return parts.length ? `also adds ${listWords(parts)}` : "";
}

/** Whether its plugin brings more than its connector. @param {{ more: { skills: number, hooks: number, commands: number, agents: number } }} row */
export const bringsMore = (row) => !!(row.more.skills || row.more.hooks || row.more.commands || row.more.agents);

/**
 * A row's line under its words: only what a person must bring, else nothing — no command, host or marketplace, which
 * nobody who knows no commands can act on (the Designer's of 10-26).
 * @param {any} row
 */
export function rowWords(row) {
  return needWords(row.needs || [], (row.servers || []).filter((/** @type {any} */ s) => s.missing && s.program).map((/** @type {any} */ s) => s.program));
}

/**
 * What its title's hover says, for those who want it: where it connects or what it runs, what else it adds, and its
 * marketplace where it is not Claude Code's.
 * @param {any} row
 */
export function detailWords(row) {
  const from = row.marketFrom === "codex" ? "from Codex's marketplace" : row.marketFrom === "added" ? `from ${row.market}` : "";
  return [serverWords(row), moreWords(row.more), from].filter(Boolean).join(" · ");
}

/** Whether every server of it connects over the web: an online service, not a tool that runs here. @param {any} row */
export const isOnline = (row) => (row.servers || []).length > 0 && row.servers.every((/** @type {any} */ s) => s.remote);

/** The groups before typing (the Designer's of 10-26). */
export const GROUPS = { mine: "Already in Claude Code", online: "Online services", local: "Tools that run on this computer" };

/** The count line: "52 connectors from Claude Code's marketplace · 4 from Codex's". @param {{ claude: number, codex: number, added: number }} c */
export function countWords(c) {
  const parts = [];
  const noun = (/** @type {number} */ n) => `${n} connector${n === 1 ? "" : "s"}`;
  if (c.claude) parts.push(`${noun(c.claude)} from Claude Code's marketplace`);
  if (c.codex) parts.push(parts.length ? `${c.codex} from Codex's` : `${noun(c.codex)} from Codex's marketplace`);
  if (c.added) parts.push(parts.length ? `${c.added} from marketplaces you added` : `${noun(c.added)} from marketplaces you added`);
  return parts.join(" · ");
}

/**
 * While plugins are still read from their repositories, how far it has got, beside a spinner (where from is no help
 * then: the Designer's of 10-26; the owner's of 10-31: "there is no feedback or loading indicator").
 * @param {number} reading @param {number} readable  those read from a repository, the ones still read among them
 */
export const readingWords = (reading, readable) => `Reading plugins: ${Math.max(0, readable - reading)} of ${readable} done — more connectors appear as they're read.`;

/** A search that finds nothing yet while plugins are still read: never said as none (the owner's of 10-31: "users might end up mistaking that connector doesn't exist"). @param {string} q */
export const notYetWords = (q) => `Nothing is named like "${q}" yet — it may still turn up as the plugins are read.`;

/** A plugin the search names whose connectors are not known yet: being read, or one that could not be (its reason on hover). */
export const LATER = { reading: "Checking…", failed: "Couldn't be read" };

/** Where a place's chats are, in a line's words: "all chats", or the project's name, or "this chat". @param {string} place @param {string} label */
const placeWords = (place, label) => (place === "all" ? "all chats" : label);

/**
 * The second step's words, once it is added (the Designer's of 10-26): what it still needs, a sign-in — asked, waited
 * on, signed in and tested —, or what it runs.
 * @param {{ title: string, servers: { remote: boolean, host: string, runs: string }[], needs: any[] }} s @param {string} where  "all chats", a project's name
 * @param {"token" | "sign-in" | "waiting" | "testing" | "signed" | "connected" | "local"} step @param {number} [tools]  the tools a test found
 */
export function setupWords(s, where, step, tools = 0) {
  const host = s.servers.find((x) => x.remote)?.host || "its site";
  if (step === "token") return `${s.title} is added for ${where}. It needs your ${s.needs.length === 1 ? lowered(s.needs[0].title) : `${s.needs.length} values`} before it works.`;
  if (step === "sign-in") return `${s.title} is added for ${where}. Sign in on ${host} so its tools can reach your account.`;
  if (step === "waiting") return `Sign in on ${host}'s page… This waits until you do, or press Cancel`;
  if (step === "testing") return `${s.title} is added for ${where}: signed in on ${host}, testing…`;
  if (step === "signed") return `${s.title} is added for ${where}: signed in on ${host} · ${tools} tool${tools === 1 ? "" : "s"}.`;
  if (step === "local") return `${s.title} is added for ${where}. It runs on this computer when a chat uses it.`;
  return `${s.title} is added for ${where}.`;
}

/** A test's answer in the sheet's words: "Connected · 41 tools". @param {any} r */
export const testedWords = (r) => (r.ok ? `Connected · ${(r.tools || []).length} tool${(r.tools || []).length === 1 ? "" : "s"}` : String(r.words || "It did not answer"));

/**
 * The sheet, open: the picker, or with `finish` the second step alone for a plugin added before.
 * @param {{ scope: string, at: string, label: string, onToast?: (msg: string, kind?: string) => void, onManual: () => void,
 *   rows: () => any[], refresh: () => Promise<void>, signIn: (row: any) => Promise<void>, cancelSignIn?: (row: any) => Promise<void>,
 *   openAgain?: (row: any) => void, watch?: (fn: (rows: any[]) => void) => () => void, finish?: string, finishTitle?: string }} o
 *   `scope`: `all`, `project:<id>` — or, finishing, the chat its plugin is on for —; `at`: `global`, `project` or
 *   `session`; `label`: the place's name ("" for the setup's own); `rows`, `signIn`, `cancelSignIn`, `openAgain`,
 *   `watch`: the list's rows and its sign-in — it opens the server's page and follows it; the sheet draws its waiting
 *   from the row each time the list draws; `finish`: a plugin's id, and its name
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, dialog?: typeof dialog, pluginSheet?: typeof pluginSheet,
 *   later?: (fn: () => void, ms: number) => any, now?: () => number }} [io]
 */
export function openConnectorPick(o, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const openDialog = io.dialog || dialog;
  const openPluginSheet = io.pluginSheet || pluginSheet;
  const later = io.later || ((fn, ms) => setTimeout(fn, ms));
  const now = io.now || Date.now;
  const toast = o.onToast || (() => {});
  /** The place in a line's words; finishing, the setup's own label names it. */
  let where = placeWords(o.scope, o.label);
  const body = m("div", { class: "mcps-sheet cpick" });
  const d = openDialog({
    title: o.finish ? `Finish setting up ${o.finishTitle || o.finish}` : "Add a connector",
    ...(o.finish ? {} : { description: `Into ${where} · ${o.at === "global" ? "each chat has it from its next message" : "each chat in it has it from its next message"}` }),
    glyph: m("span", { class: "mcps-tile", "aria-hidden": "true", html: ICONS.plug }),
    body,
    wide: true,
  });
  const open = () => body.isConnected !== false;
  const btn = (/** @type {string} */ label, /** @type {string} */ variant, /** @type {() => void} */ onClick, /** @type {Record<string, any>} */ extra = {}) =>
    m("button", { class: `zc-btn zc-btn-v-${variant} zc-btn-s-sm${extra.class ? ` ${extra.class}` : ""}`, type: "button", onclick: onClick, ...(extra.disabled ? { disabled: "" } : {}), ...(extra.label ? { "aria-label": extra.label } : {}) },
      m("span", { class: "zc-btn-label" }, label));
  const lead = (/** @type {string} */ text) => m("p", { class: "cpick-lead" }, text);
  const footOf = (/** @type {any[]} */ ...buttons) => m("div", { class: "mcps-sheet-foot" }, ...buttons);
  const result = (/** @type {string} */ text, /** @type {boolean} */ ok) => m("div", { class: `mcps-result${ok ? "" : " is-bad"}`, role: "status" },
    m("div", { class: "mcps-result-head" }, m("span", { class: `mcps-dot ${ok ? "is-ok" : "is-bad"}`, "aria-hidden": "true" }), text));
  /** A plugin's server tested as this place starts it. @param {string} name */
  const testOf = (name) => call("/mcp-servers/test", { method: "POST", body: { scope: o.scope, server: { name, plugin: true } } });

  // ---- the second step: what it still needs ---------------------------------------------------------------------------

  /** @param {any} s  the setup: its plugin, title, place, servers and the values it still needs */
  function setup(s) {
    if (!open()) return;
    where = placeWords(s.place, s.label || where);
    if (s.needs?.length) return tokenStep(s);
    if (s.servers.some((/** @type {any} */ x) => x.remote)) return void webStep(s);
    localStep(s);
  }

  /** @param {any} s */
  function tokenStep(s) {
    const error = m("p", { class: "mcps-error", role: "alert" });
    const fields = s.needs.map((/** @type {any} */ a) => {
      const input = /** @type {HTMLInputElement} */ (m("input", { class: "zc-input mcps-input", type: a.sensitive ? "password" : "text", spellcheck: "false", autocomplete: "off", "aria-label": a.title, "data-key": a.key }));
      return { a, input, el: m("div", { class: "mcps-field" }, m("span", { class: "mcps-k" }, a.title),
        m("div", { class: "mcps-v" }, input, m("span", { class: "mcps-hint mcps-mono" }, a.key), a.description ? m("span", { class: "mcps-hint" }, a.description) : null, a.sensitive ? m("span", { class: "mcps-hint" }, SEALED) : null)) };
    });
    const status = m("div", { class: "cpick-status" });
    const save = btn("Save and test", "default", () => void send());
    const foot = footOf(btn("Later", "outline", () => d.close()), save);
    body.replaceChildren(lead(setupWords(s, where, "token")), m("div", { class: "mcps-fields" }, ...fields.map((f) => f.el)), error, status, foot);
    fields[0]?.input.focus?.();
    async function send() {
      const values = Object.fromEntries(fields.map((f) => [f.a.key, String(f.input.value || "").trim()]).filter(([, v]) => v));
      const missing = fields.filter((f) => !values[f.a.key]).map((f) => f.a.title);
      if (missing.length) return void error.replaceChildren(`Give ${listWords(missing.map(lowered))}`);
      error.replaceChildren("");
      save.setAttribute("disabled", "");
      try {
        // What the place keeps already stays: a secret comes back as the placeholder, which keeps it.
        const kept = await call(`/plugins/installed/${encodeURIComponent(s.plugin)}/values?place=${encodeURIComponent(o.scope)}`);
        await call(`/plugins/installed/${encodeURIComponent(s.plugin)}/values`, { method: "POST", body: { place: o.scope, values: { ...(kept.values || {}), ...values } } });
        await o.refresh();
        status.replaceChildren(m("p", { class: "mcps-quiet" }, "Testing…"));
        const r = await testOf(s.servers[0].name);
        if (!r.ok && r.signIn) return signInStep(s);
        status.replaceChildren(result(testedWords(r), !!r.ok));
        await o.refresh();
        foot.replaceChildren(...(r.ok ? [btn("Done", "default", () => d.close())] : [btn("Later", "outline", () => d.close()), save]));
      } catch (e) {
        error.replaceChildren(errText(e));
      } finally {
        save.removeAttribute("disabled");
      }
    }
  }

  /** Over the web: tested at once — connected, or its site asks you to sign in. @param {any} s */
  async function webStep(s) {
    body.replaceChildren(lead(setupWords(s, where, "connected").replace(/\.$/, ": connecting…")));
    /** @type {any} */
    let r;
    try {
      r = await testOf(s.servers.find((/** @type {any} */ x) => x.remote).name);
    } catch (e) {
      r = { ok: false, words: errText(e) };
    }
    if (!open()) return;
    await o.refresh();
    if (!r.ok && r.signIn) return signInStep(s);
    body.replaceChildren(
      lead(r.ok ? `${setupWords(s, where, "connected").replace(/\.$/, "")}: ${testedWords(r).toLowerCase()}.` : setupWords(s, where, "connected")),
      ...(r.ok ? [] : [result(testedWords(r), false)]),
      footOf(btn("Done", "default", () => d.close())));
  }

  /**
   * Its site asks for a sign-in (the Designer's of 10-26, option B): its own press — a page opened by a press is not
   * blocked — handed to the list's row, which opens the page and follows it; the sheet waits, drawn from that row each
   * time the list draws — waiting with Open it again and Cancel, then signed in and testing, then its tools — so one
   * toast says it and nothing follows it twice. Cancel ends the sign-in and asks again; × leaves it waiting on its row.
   * @param {any} s
   */
  function signInStep(s) {
    const server = s.servers.find((/** @type {any} */ x) => x.remote) || s.servers[0];
    let stop = () => {};
    let pressed = 0;
    let waited = false;
    const ask = () => {
      stop();
      pressed = 0;
      waited = false;
      body.replaceChildren(lead(setupWords(s, where, "sign-in")), footOf(btn("Later", "outline", () => d.close()), btn("Sign in", "default", () => void signIn())));
    };
    const rowNow = () => o.rows().find((r) => r.name === server.name) || null;
    /** @param {any} row */
    function draw(row) {
      if (!open()) return stop();
      if (!row || !pressed) return;
      const st = row.signIn?.state;
      if (st === "waiting") {
        waited = true;
        body.replaceChildren(lead(setupWords(s, where, "waiting")), footOf(
          btn("Open it again", "outline", () => o.openAgain?.(row)),
          btn("Cancel", "outline", () => void (async () => { await o.cancelSignIn?.(row); ask(); })())));
        return;
      }
      if (st === "in") {
        // Its test after the sign-in, which the row runs once it is done.
        const t = row.test && row.test.at >= pressed ? row.test : null;
        if (!t) return void body.replaceChildren(lead(setupWords(s, where, "testing")), footOf(btn("Done", "default", () => d.close())));
        stop();
        body.replaceChildren(
          lead(t.ok ? setupWords(s, where, "signed", (t.tools || []).length) : `${s.title} is added for ${where}: signed in on ${server.host || "its site"}.`),
          ...(t.ok ? [] : [result(String(t.words || "It did not answer"), false)]),
          footOf(btn("Done", "default", () => d.close())));
        return;
      }
      // Ended, refused or cancelled on its page: asked again.
      if (waited) ask();
    }
    async function signIn() {
      const row = rowNow();
      if (!row) return void toast(`${server.name} is not in the list yet: press Sign in on its row`, "err");
      pressed = now() - 2000;
      stop = o.watch ? o.watch((rows) => draw(rows.find((r) => r.name === server.name))) : () => {};
      await o.signIn(row);
      draw(rowNow());
    }
    ask();
  }

  /** It runs on this computer: Test when you like. @param {any} s */
  function localStep(s) {
    const status = m("div", { class: "cpick-status" });
    const test = btn("Test", "outline", () => void run());
    body.replaceChildren(lead(setupWords(s, where, "local")), status, footOf(test, btn("Done", "default", () => d.close())));
    async function run() {
      test.setAttribute("disabled", "");
      status.replaceChildren(m("p", { class: "mcps-quiet" }, "Starting it…"));
      try {
        const r = await testOf(s.servers[0].name);
        status.replaceChildren(result(testedWords(r), !!r.ok));
        await o.refresh();
      } catch (e) {
        status.replaceChildren(result(errText(e), false));
      } finally {
        test.removeAttribute("disabled");
      }
    }
  }

  if (o.finish) {
    body.replaceChildren(m("p", { class: "mcps-quiet" }, "Reading what it needs…"));
    void call(`/plugins/connectors/setup?id=${encodeURIComponent(o.finish)}&place=${encodeURIComponent(o.scope)}`).then(setup, (e) => body.replaceChildren(m("p", { class: "mcps-failed" }, errText(e))));
    return d;
  }

  // ---- the first step: the list ---------------------------------------------------------------------------------------

  const search = /** @type {HTMLInputElement} */ (m("input", { class: "zc-input cpick-search", type: "search", spellcheck: "false", autocomplete: "off", placeholder: SEARCH_HINT, "aria-label": "Search connectors" }));
  const count = m("p", { class: "mcps-hint cpick-count" });
  // How far the reading has got, under the count while plugins are still read: one spinner that keeps turning as its
  // words change with each read (the owner's of 10-31).
  const progressWords = m("span", { class: "cpick-progress-words" });
  const progress = m("p", { class: "mcps-hint cpick-progress", hidden: "" }, m("span", { class: "tk-spin", "aria-hidden": "true", html: ICONS.loader }), progressWords);
  const list = m("div", { class: "cpick-list" }, m("p", { class: "mcps-quiet" }, "Reading the marketplaces…"));
  const foot = m("div", { class: "mcps-sheet-foot cpick-foot" },
    m("button", { class: "cpick-hand", type: "button", onclick: () => { d.close(); o.onManual(); } }, BY_HAND),
    btn("Cancel", "outline", () => d.close()));
  body.replaceChildren(search, count, progress, list, foot);
  search.focus?.();
  /** @type {any} */
  let got = null;
  /** The rows being added now, by their marketplace and name. */
  const adding = new Set();
  /** @type {any} */
  let typing = null;
  let asked = 0;
  /** Each row's element by its marketplace and name, kept while its words and state stand. @type {Map<string, { sig: string, el: any }>} */
  const rowEls = new Map();
  /** What the list drew last: a read that finds the same leaves it be. */
  let drawn = "";

  async function read() {
    const n = ++asked;
    try {
      const r = await call(`/plugins/connectors?q=${encodeURIComponent(String(search.value || "").trim())}&place=${encodeURIComponent(o.scope)}`);
      if (n !== asked || !open()) return;
      got = r;
      paint();
      // More arrive as their repositories are read: looked at again while the sheet is open.
      if (r.reading > 0) later(() => { if (open() && n === asked) void read(); }, 3000);
    } catch (e) {
      if (n === asked) {
        drawn = "";
        progress.toggleAttribute("hidden", true);
        list.replaceChildren(m("p", { class: "mcps-failed" }, errText(e)));
      }
    }
  }
  search.addEventListener("input", () => {
    if (typing) clearTimeout(typing);
    typing = later(() => void read(), 200);
  });

  /** @param {any} row */
  function rowEl(row) {
    const key = `${row.from}\n${row.name}`;
    const ctl = adding.has(key)
      ? btn("Adding…", "outline", () => {}, { disabled: true })
      : row.on === "here"
        ? m("span", { class: "cpick-state" }, "Added")
        : row.on === "all" && o.at !== "global"
          ? m("span", { class: "cpick-state" }, `On for ${row.onIn || "all chats"}`)
          : bringsMore(row)
            ? btn("Add…", "outline", () => more(row), { label: `Add ${row.title}…` })
            : btn("Add", "outline", () => void add(row), { label: `Add ${row.title}` });
    const needs = rowWords(row);
    return m("div", { class: "mcps-row cpick-row", "data-name": row.name },
      m("div", { class: "mcps-text" },
        m("div", { class: "mcps-label" }, m("span", { class: "mcps-name", title: detailWords(row) }, row.title)),
        row.line ? m("div", { class: "mcps-sub cpick-line", title: row.line }, row.line) : null,
        needs ? m("div", { class: "mcps-sub cpick-how" }, needs) : null),
      m("span", { class: "mcps-ctl" }, ctl));
  }

  /**
   * A plugin the search names whose connectors are not known yet: its marketplace's words, and Checking… while it is
   * read — or that it could not be, its reason on hover (the owner's of 10-31: "users might end up mistaking that
   * connector doesn't exist").
   * @param {any} p
   */
  function laterEl(p) {
    const ctl = p.state === "failed"
      ? m("span", { class: "cpick-state", title: p.why || null }, LATER.failed)
      : m("span", { class: "cpick-state cpick-checking" }, m("span", { class: "tk-spin", "aria-hidden": "true", html: ICONS.loader }), LATER.reading);
    return m("div", { class: `mcps-row cpick-row is-later${p.state === "failed" ? " is-failed" : ""}`, "data-name": p.name },
      m("div", { class: "mcps-text" },
        m("div", { class: "mcps-label" }, m("span", { class: "mcps-name" }, p.title)),
        p.line ? m("div", { class: "mcps-sub cpick-line", title: p.line }, p.line) : null),
      m("span", { class: "mcps-ctl" }, ctl));
  }

  /** An element drawn before, kept while what it shows stands. @param {string} key @param {string} sig @param {() => any} make */
  function keptEl(key, sig, make) {
    const had = rowEls.get(key);
    if (had?.sig === sig) return had;
    const made = { sig, el: make() };
    rowEls.set(key, made);
    return made;
  }
  /** A row's element, the one drawn before while its words and state stand. @param {any} row */
  const rowOf = (row) => keptEl(`${row.from}\n${row.name}`, JSON.stringify([row, adding.has(`${row.from}\n${row.name}`)]), () => rowEl(row));
  /** @param {any} p */
  const laterOf = (p) => keptEl(`later\n${p.from}\n${p.name}`, JSON.stringify(p), () => laterEl(p));

  function paint() {
    if (!got) return;
    progress.toggleAttribute("hidden", !(got.reading > 0));
    if (got.reading > 0) progressWords.replaceChildren(readingWords(got.reading, got.readable));
    if (got.none) {
      drawn = "";
      count.replaceChildren("");
      const go = btn(GET_LIST, "default", () => void fetchList(go));
      list.replaceChildren(m("div", { class: "cpick-none" }, m("p", { class: "mcps-quiet" }, NO_LIST), go, m("p", { class: "mcps-hint" }, NO_LIST_QUIET)));
      return;
    }
    count.replaceChildren(countWords(got.counts));
    const rows = got.connectors || [];
    const pending = got.pending || [];
    const q = String(search.value || "").trim();
    if (!rows.length && !pending.length) {
      drawn = "";
      list.replaceChildren(m("p", { class: "mcps-quiet" }, q ? (got.reading ? notYetWords(q) : `No connector is named like "${q}".`) : got.reading ? "Reading the marketplaces' plugins…" : "The marketplaces here list no connector."));
      return;
    }
    // Before typing (the Designer's of 10-26): those Claude Code has installed, then the online services, then the tools
    // that run on this computer, A–Z in each; typing, one list as the search ranks it, then the plugins it names whose
    // connectors are not known yet.
    /** @type {[string, { sig: string, el: any }[]][]} */
    const groups = [];
    if (q) groups.push(["", [...rows.map(rowOf), ...pending.map(laterOf)]]);
    else {
      const mine = rows.filter((/** @type {any} */ r) => (r.installedIn || []).includes("Claude Code"));
      const rest = rows.filter((/** @type {any} */ r) => !mine.includes(r));
      groups.push([GROUPS.mine, mine.map(rowOf)], [GROUPS.online, rest.filter(isOnline).map(rowOf)], [GROUPS.local, rest.filter((/** @type {any} */ r) => !isOnline(r)).map(rowOf)]);
    }
    // The list is read again every 3 s while marketplaces are read: rows that stand keep their elements, and a list
    // that stands whole is not drawn again, so no Add is replaced under a press.
    const shown = groups.filter(([, els]) => els.length);
    const sig = JSON.stringify([q, shown.map(([label, els]) => [label, els.map((x) => x.sig)])]);
    if (sig === drawn) return;
    drawn = sig;
    list.replaceChildren(...shown.flatMap(([label, els]) => [...(label ? [m("h4", { class: "cpick-group" }, label)] : []), m("div", { class: "mcps-rows" }, ...els.map((x) => x.el))]));
  }

  /** @param {any} go */
  async function fetchList(go) {
    go.setAttribute("disabled", "");
    go.replaceChildren(m("span", { class: "zc-btn-label" }, "Getting the list…"));
    try {
      await call("/plugins/connectors/anthropic", { method: "POST", body: {} });
      await read();
    } catch (e) {
      toast(errText(e), "err");
      go.removeAttribute("disabled");
      go.replaceChildren(m("span", { class: "zc-btn-label" }, GET_LIST));
    }
  }

  /** More than a connector: its plugin's sheet, the place picked, its hooks off. @param {any} row */
  function more(row) {
    d.close();
    openPluginSheet({ from: row.from, name: row.name, place: o.scope, onDone: () => void o.refresh(), onToast: toast });
  }

  /** @param {any} row */
  async function add(row) {
    const key = `${row.from}\n${row.name}`;
    adding.add(key);
    paint();
    try {
      const s = await call("/plugins/connectors/add", { method: "POST", body: { from: row.from, name: row.name, place: o.scope } });
      await o.refresh();
      toast(`${s.title} added for ${where}`);
      setup(s);
    } catch (e) {
      toast(errText(e), "err");
      adding.delete(key);
      paint();
    }
  }

  void read();
  return d;
}
