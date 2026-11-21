// @ts-check
// The command center (AgentPlanUX §5.11; Ctrl+K / Ctrl+Shift+P, the sidebar's Search row): quick actions, recent
// tasks (the archive's full-text search: title and content), the current task's recent changes (B2) and project
// files (B3), filtered as you type under scope tabs All · Actions · Settings · Chats · Files. Arrows move, Tab cycles
// the scope, Enter runs, Esc or a click outside closes. The last eight queries are kept as a search history. Each row
// wears its kind's tile and an action its shortcut, so the palette also teaches the keys. Since the design pass of
// 10-24 (UX7) a setting typed — "line 70", "ask", "max", "1m", "sonnet", "mem off", "may product" — is a
// row under This chat that changes it for this chat (lib/setting-intents.js), saying where it stands now and what the
// change does; the Settings scope shows what else to type, each example a press that types it.
import { h } from "../lib/dom.js";
import { api } from "./lib/api.js";
import { store } from "../lib/store.js";
import { dialog, pills } from "./lib/ui.js";
import { fileTag, sessionAge } from "./lib/labels.js";
import { ICONS } from "./lib/icons.js";
import { comboOf } from "./shortcuts.js";
import { newestOnRecord } from "./conversation/history.js";
import { WORDS } from "./lib/words.js";
import { settingRows, settingExamples, NOT_STARTED } from "./lib/setting-intents.js";

const HISTORY_KEY = "harness.searchHistory";
const SCOPES = [
  { id: "all", label: "All" },
  { id: "actions", label: "Actions" },
  { id: "settings", label: "Settings" },
  { id: "tasks", label: WORDS.chats },
  { id: "files", label: "Files" },
];

/** @typedef {{ label: string, run: () => void, detail?: string, snippet?: string, icon?: string, tone?: string, keys?: string, mono?: boolean }} CcRow */
/**
 * @typedef {{ id: string, label: string, run: () => void, icon?: string, tone?: string, shortcut?: string, when?: () => boolean }} CcAction
 *   `shortcut` its id in the shortcut registry: the row shows the combo it answers to now; `when`, if it has one, says
 *   whether it is offered now (a session's views, while there is a session)
 */

const TASK_TONE = "var(--color-sys-gray)";
/** The recent changes listed. */
const CHANGE_ROWS = 6;
/**
 * How long a paint waits for all its reads before it draws the parts that came: a slow one (a turn's first read after
 * a start walks its git) leaves the rest drawn, where the list stood empty until it came. Past the archive's search and
 * the files search (2–94 ms on the owner's machine, 11-18) with a remote link's way there and back, so a keystroke's
 * list is drawn once, whole, as it was.
 */
export const SLOW_PARTS_MS = 300;

/** The typed text marked in a row's label (the first match, case-insensitive). @param {string} label @param {string} q */
function marked(label, q) {
  const at = q ? label.toLowerCase().indexOf(q) : -1;
  if (at < 0) return [label];
  return [label.slice(0, at), h("mark", { class: "cc-mark" }, label.slice(at, at + q.length)), label.slice(at + q.length)].filter((x) => x !== "");
}

/** A combo as keycaps: "Ctrl+Shift+[" → Ctrl · Shift · [ (and "Ctrl++" → Ctrl · +). @param {string} combo */
export function comboKeys(combo) {
  const s = String(combo || "");
  return (s.endsWith("++") ? [...s.slice(0, -2).split("+"), "+"] : s.split("+")).filter(Boolean);
}

/** The last eight queries, newest first. */
export function searchHistory() {
  try {
    const v = JSON.parse(store.get(HISTORY_KEY) || "[]");
    return Array.isArray(v) ? v.filter((q) => typeof q === "string" && q.trim()).slice(0, 8) : [];
  } catch {
    return [];
  }
}
/** @param {string} q */
export function rememberSearch(q) {
  const t = String(q || "").trim();
  if (!t) return;
  store.set(HISTORY_KEY, JSON.stringify([t, ...searchHistory().filter((x) => x !== t)].slice(0, 8)));
}

/** The next scope id from the current one, Tab / Shift+Tab. @param {string} current @param {number} dir */
export function nextScope(current, dir) {
  const at = Math.max(0, SCOPES.findIndex((s) => s.id === current));
  return SCOPES[(at + dir + SCOPES.length) % SCOPES.length].id;
}

/** The actions offered for the typed text (lower-cased): those offered now whose label holds it. @param {CcAction[]} actions @param {string} q */
export const actionsFor = (actions, q) => actions.filter((a) => (!a.when || a.when()) && (!q || a.label.toLowerCase().includes(q)));

/**
 * The Settings part for what is typed: the rows that change this chat's settings, the lines that say why one is not
 * offered, and — in the Settings scope, or where nothing else matched — what else to type.
 * @param {string} raw @param {string} scope @param {import("./lib/setting-intents.js").SettingFacts | null} facts @param {number} found  the rows the other parts found
 */
export function settingsPart(raw, scope, facts, found) {
  if (!facts || (scope !== "all" && scope !== "settings")) return { rows: [], why: [], examples: [] };
  const said = settingRows(raw, facts);
  if (!facts.chat && scope === "settings" && !said.why.length) said.why.push(NOT_STARTED);
  const examples = scope === "settings" || (raw && !said.rows.length && !said.why.length && !found) ? settingExamples(facts) : [];
  return { ...said, examples };
}

/**
 * @param {{ actions: () => CcAction[], onOpenTask: (id: string) => void, getFolder?: () => string, onInsert?: (text: string) => void, getChat?: () => any, onOpenChanges?: (path: string) => void,
 *   settings?: () => import("./lib/setting-intents.js").SettingFacts | null, onSetting?: (row: import("./lib/setting-intents.js").SettingRow) => void }} cb
 *   `actions`: the list, or what lists them as they are each time it asks (the panes' doors follow what is open);
 *   `settings`: the open chat as Ctrl+K reads it to change its settings; `onSetting`: a setting row run
 * @returns {{ open: () => void }}
 */
export function createCommandCenter(cb) {
  /** @param {string} query @param {AbortSignal} signal */
  async function tasks(query, signal) {
    try {
      const r = await api(`/memory/sessions?limit=20${query ? `&q=${encodeURIComponent(query)}` : ""}`, { signal });
      return r.sessions || [];
    } catch {
      return [];
    }
  }

  /**
   * The current task's changed files whose path holds `q`, from the newest finished turn's snapshots (B2): the server
   * cuts them (`?match=`), so a keystroke moves the few rows shown. A host that answers whole says no `match`: its
   * answer is held for the open, by the turn it is of, and cut here — not one that names a place git could not read, or
   * holds no list of files, which the next keystroke asks again.
   * @param {string} q  lower-cased @param {{ key: string, r: any }} held  this open's @param {AbortSignal} signal
   */
  async function recentChanges(q, held, signal) {
    const chat = cb.getChat?.();
    const last = newestOnRecord((chat?.turns || []).filter((/** @type {any} */ t) => !t.past && t.status !== "streaming"));
    const n = last?.rec?.memory?.turn || 0;
    if (!chat?.chainId || !n) return [];
    const key = `${chat.chainId}\n${n}\n${chat.cwd || ""}`;
    try {
      const r = held.key === key
        ? held.r
        : await api(`/memory/sessions/${encodeURIComponent(chat.chainId)}/changes?turn=${n}&cwd=${encodeURIComponent(chat.cwd || "")}&match=${encodeURIComponent(q)}&take=${CHANGE_ROWS}`, { signal });
      if (!r?.match && Array.isArray(r?.files) && !r.errors?.length) Object.assign(held, { key, r });
      // A file in another place than the chat's folder is named by its whole path (HarnessV4_Git_Plan GW-D3).
      return (r?.files || []).map((/** @type {any} */ f) => ({
        path: f.place && r.folder && f.place !== r.folder ? `${f.place}/${f.path}` : String(f.path),
        status: String(f.status || ""),
        added: Number(f.added) || 0,
        removed: Number(f.removed) || 0,
      })).filter((/** @type {{ path: string }} */ f) => !q || f.path.toLowerCase().includes(q)).slice(0, CHANGE_ROWS);
    } catch {
      return [];
    }
  }

  return {
    open() {
      if (document.querySelector(".cc")) return; // one at a time; a second Ctrl+K must not stack another
      let scope = "all";
      const input = h("input", { class: "zc-input cc-input", type: "text", placeholder: "Search actions, chats, or files — or type a setting: line 70", "aria-label": "Search actions, settings, chats, or files" });
      const list = h("div", { class: "cc-list" });
      const scopePills = pills(SCOPES, { active: scope, onChange: (id) => { scope = id; paint(); } });
      let hi = 0;
      let seq = 0;
      /** @type {CcRow[]} */
      let rows = [];
      /** @type {HTMLElement[]} */
      let rowEls = [];
      let historyOpen = false;

      /** The highlight moves without a repaint: a repaint searches the archive again. */
      const paintHi = () => {
        rowEls.forEach((el, i) => el.classList.toggle("on", i === hi));
        rowEls[hi]?.scrollIntoView({ block: "nearest" });
      };

      /** This open's hold on a whole answer, from a host that does not cut it (`recentChanges`). */
      const held = { key: "", r: null };
      /**
       * The reads of the paint under way, let go by a newer paint or the dialog closed: while a turn's walk runs, its
       * `?match=` answers wait on it, and each held one of the browser's six connections to Filament, so a few keystrokes
       * held every other read of the page behind them.
       * @type {AbortController | null}
       */
      let reading = null;

      const paint = async () => {
        const mine = ++seq;
        reading?.abort();
        const { signal } = (reading = new AbortController());
        const raw = input.value.trim();
        const q = raw.toLowerCase();
        /** @param {string} s */
        const want = (s) => scope === "all" || scope === s;
        /** @type {CcRow[]} */
        const actions = want("actions")
          ? actionsFor(cb.actions(), q).map((a) => ({ label: a.label, run: a.run, icon: a.icon || "arrowRight", tone: a.tone, keys: a.shortcut ? comboOf(a.shortcut) : "" }))
          : [];
        const folder = cb.getFolder?.() || "";
        // The three reads side by side, each its section's rows; one that fails lists none.
        /** @type {Promise<CcRow[]>[]} */
        const parts = [
          (want("tasks") ? tasks(raw, signal) : Promise.resolve([])).then((found) => found.slice(0, 8).map((/** @type {any} */ s) => ({
            label: s.title || s.preview || "(untitled chat)",
            detail: [s.projectName || (s.cwd ? String(s.cwd).split(/[\\/]/).pop() : ""), sessionAge(s.when)].filter(Boolean).join(" · "),
            snippet: q && s.state && String(s.state).toLowerCase().includes(q) ? String(s.state) : undefined,
            icon: "messageSquare",
            tone: TASK_TONE,
            run: () => cb.onOpenTask(s.id),
          }))),
          (want("files") ? recentChanges(q, held, signal) : Promise.resolve([])).then((changes) => changes.map((f) => ({
            label: f.path,
            detail: [f.status, f.added ? `+${f.added}` : "", f.removed ? `−${f.removed}` : ""].filter(Boolean).join(" "),
            icon: "fileDiff",
            tone: "var(--color-sys-green)",
            mono: true,
            run: () => (cb.onOpenChanges ? cb.onOpenChanges(f.path) : cb.onInsert?.(`${fileTag(f.path)} `)),
          }))),
          (want("files") && folder && q
            ? api(`/files/search?cwd=${encodeURIComponent(folder)}&q=${encodeURIComponent(raw)}&limit=8`, { signal }).catch(() => null)
            : Promise.resolve(null)
          ).then((fileHits) => (fileHits?.files || []).map((/** @type {any} */ f) => ({ label: String(f.path), icon: "file", tone: "var(--color-sys-blue)", mono: true, run: () => cb.onInsert?.(`${fileTag(String(f.path))} `) }))),
        ];
        /** Each part's rows once it came. @type {(CcRow[] | null)[]} */
        const came = parts.map(() => null);
        parts.forEach((p, k) => p.then((got) => void (came[k] = got)));
        await Promise.race([Promise.all(parts), new Promise((r) => setTimeout(r, SLOW_PARTS_MS))]);
        // Drawn up to the first part still out, so a row only ever comes below the ones drawn; the last draw is whole.
        for (;;) {
          if (mine !== seq) return; // a newer keystroke paints
          const out = came.indexOf(null);
          draw(raw, actions, came, out < 0 ? came.length : out);
          if (out < 0) return;
          came[out] = await parts[out];
        }
      };

      /**
       * The list as the parts that came draw it, the first `upto` of them: the empty line, the examples that follow
       * what was found and the history wait for the last.
       * @param {string} raw @param {CcRow[]} actions @param {(CcRow[] | null)[]} came @param {number} upto
       */
      const draw = (raw, actions, came, upto) => {
        const q = raw.toLowerCase();
        const [taskRows, changeRows, fileRows] = came.map((got, k) => (k < upto && got) || []);
        const whole = upto === came.length;
        const set = settingsPart(raw, scope, cb.settings?.() || null, actions.length + taskRows.length + changeRows.length + fileRows.length);
        if (!whole) set.examples = [];
        /** @type {CcRow[]} */
        const setRows = set.rows.map((r) => ({ label: r.label, detail: r.now, snippet: r.effect || undefined, icon: r.icon, tone: r.tone, run: () => cb.onSetting?.(r) }));
        rows = [...actions, ...setRows, ...taskRows, ...changeRows, ...fileRows];
        if (whole && (hi >= rows.length || hi < 0)) hi = 0;
        rowEls = [];
        let i = 0;
        /** @param {string} label @param {CcRow[]} xs */
        const section = (label, xs) => (xs.length ? [h("div", { class: "cc-label" }, label), ...xs.map((r) => item(r, i++, q))] : []);
        const hist = whole ? searchHistory() : [];
        list.replaceChildren(...[
          ...section("Quick actions", actions),
          ...section("This chat", setRows),
          // Why a setting typed is not offered: under its rows, or under the group's name where there is none.
          ...(set.why.length ? [setRows.length ? null : h("div", { class: "cc-label" }, "This chat"), ...set.why.map((w) => h("div", { class: "cc-why" }, w))] : []),
          ...section("Recent chats", taskRows),
          ...section("Recent changes", changeRows),
          ...section("Files", fileRows),
          // Nothing typed in Settings is no search that failed: its examples alone.
          !whole || rows.length || set.why.length || (set.examples.length && !raw) ? null : h("div", { class: "cc-empty" }, "No related results"),
          set.examples.length
            ? h("div", { class: "cc-also" },
                h("div", { class: "cc-label" }, "Also type"),
                h("div", { class: "cc-try" }, ...set.examples.map((e) => h("button", {
                  class: "cc-try-chip", type: "button", title: `Type “${e.code}”`,
                  onclick: () => { input.value = e.code; hi = 0; paint(); input.focus(); },
                }, h("code", {}, e.code), e.words))))
            : null,
          hist.length && !raw
            ? h("div", { class: "cc-history" },
                h("button", { class: "cc-history-head", type: "button", onclick: () => { historyOpen = !historyOpen; paint(); } },
                  h("span", {}, "Search history"),
                  h("span", { class: "cc-history-chev", html: historyOpen ? ICONS.chevronUp : ICONS.chevronDown })),
                historyOpen
                  ? h("div", { class: "cc-history-body" },
                      ...hist.map((hq) => h("button", { class: "cc-row", type: "button", onclick: () => { input.value = hq; paint(); input.focus(); } }, hq)),
                      h("button", { class: "cc-row cc-clear", type: "button", onclick: () => { store.set(HISTORY_KEY, "[]"); paint(); } }, "Clear history"))
                  : null)
            : null].filter((x) => x != null));
      };

      /** @param {CcRow} row @param {number} i @param {string} q */
      const item = (row, i, q) => {
        const el = h("button", {
          class: `cc-row${i === hi ? " on" : ""}`,
          type: "button",
          onclick: () => { rememberSearch(input.value); d.close(); row.run(); },
          onpointermove: () => { if (hi !== i) { hi = i; paintHi(); } },
        },
          row.icon ? h("span", { class: "cc-ic", style: `--tone:${row.tone || TASK_TONE}`, html: /** @type {any} */ (ICONS)[row.icon] || "" }) : null,
          h("span", { class: "cc-main" },
            h("span", { class: "cc-title" }, h("span", { class: `cc-name${row.mono ? " mono" : ""}` }, ...marked(row.label, q)), row.detail ? h("span", { class: "cc-detail" }, row.detail) : null),
            row.snippet ? h("span", { class: "cc-snippet" }, row.snippet) : null),
          row.keys ? h("span", { class: "cc-keys", "aria-hidden": "true" }, ...comboKeys(row.keys).map((k) => h("kbd", {}, k))) : null,
          h("span", { class: "cc-enter", "aria-hidden": "true", html: ICONS.cornerDownLeft }));
        rowEls.push(el);
        return el;
      };

      input.addEventListener("input", paint);
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); hi = rows.length ? Math.min(rows.length - 1, hi + 1) : 0; paintHi(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); hi = Math.max(0, hi - 1); paintHi(); }
        else if (e.key === "Tab") { e.preventDefault(); scope = nextScope(scope, e.shiftKey ? -1 : 1); scopePills.setActive(scope); paint(); }
        else if (e.key === "Enter" && rows[hi]) { e.preventDefault(); rememberSearch(input.value); d.close(); rows[hi].run(); }
      });

      const field = h("label", { class: "cc-field" },
        h("span", { class: "cc-field-ic", "aria-hidden": "true", html: ICONS.search }),
        input,
        h("button", { class: "cc-esc", type: "button", title: "Close (Esc)", "aria-label": "Close", onclick: () => d.close() }, "esc"));
      const foot = h("div", { class: "cc-foot", "aria-hidden": "true" },
        h("span", {}, h("kbd", {}, "↑"), h("kbd", {}, "↓"), " to move"),
        h("span", {}, h("kbd", {}, "↵"), " to open"),
        h("span", {}, h("kbd", {}, "Tab"), " for the next scope"));
      const d = dialog({ title: "Command center", cls: "is-cc", body: h("div", { class: "cc" }, field, scopePills.el, list, foot), actions: [], onClose: () => {
        // Closed: no paint draws, and its reads go.
        seq++;
        reading?.abort();
      } });
      // A click on the dimmed window closes it, as Spotlight does; the dialog's own backdrop counts as inside it.
      d.el.addEventListener("pointerdown", (e) => { if (e.target === d.el) d.close(); });
      paint();
      input.focus();
    },
  };
}
