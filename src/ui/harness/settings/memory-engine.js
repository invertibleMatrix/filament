// @ts-check
// Memory's engine in the harness (HarnessV4_Settings_Plan HS-4): where the engine stands, with Install, Restart and
// Uninstall; then the few settings of memory a person sets here (the owner's of 11-09), kept at once
// (lib/config-rows.js): recall by meaning, the backups, and under Advanced the memory folder. Every other key of the
// `memory` group stays in the configuration, set from the console or the command line, and is not drawn: the
// autopilot's and capture's tuning, the bank (another database, switched silently), the curator's and the commands'.
// An install's percent comes on the events feed's `engine`; the engine is read again once it ends. Built with an
// injected `h`, `api`, bus and confirm, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { onBus } from "../lib/bus.js";
import { confirmDialog } from "../lib/ui.js";
import { mountConfigPage } from "../lib/config-rows.js";
import { engineProgress, engineMissing, installWords, otherEngine, OTHER_ENGINE_WORDS, RESTART_WORDS, restartEngine, stallWords, uninstallWords } from "../../lib/engine.js";

/** Settings search's words for these rows (search.js, HS-D68): the engine, and memory's settings as they are drawn. */
export const SEARCH_ROWS = Object.freeze([
  { label: "The engine", words: "install restart uninstall mnemosyne" },
  { path: "memory.engine.embeddings", label: "Recall by meaning", words: "embeddings semantic" },
  { path: "memory.backups.enabled", label: "Back up daily", words: "backups" },
  { path: "memory.backups.folder", label: "Backup folder", words: "backups google drive onedrive" },
  { path: "memory.backups.hour", label: "Hour of day", words: "backups" },
  { path: "memory.backups.keep", label: "Backups kept", words: "backups" },
  { path: "memory.folder", label: "Memory folder", words: "archive drive" },
]);

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, onChanged?: () => void }} [cb]
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, bus?: typeof onBus, confirm?: typeof confirmDialog }} [io]
 */
export function renderMemoryEngine(body, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const ask = io.confirm || confirmDialog;
  const toast = cb.onToast || (() => {});
  const lineEl = m("div", { class: "mset-engine-line" });
  const settingsEl = m("div", {});
  body.replaceChildren(m("h3", { class: "nset-h" }, "Memory's engine"), lineEl, settingsEl);

  /** What `GET /api/memory/status` said, and where the engine stands now (the feed's `engine`, newer). */
  /** @type {any} */
  let status = null;
  /** @type {any} */
  let now = null;
  let busy = false;
  /** Whether memory installs a missing engine by itself (`memory.engine.autoInstall`), as the configuration says. */
  let settingsAutoInstall = /** @type {boolean | undefined} */ (undefined);

  const read = async () => {
    try {
      status = await call("/memory/status");
      now = null;
    } catch (/** @type {any} */ e) {
      lineEl.replaceChildren(m("p", { class: "set-error" }, `Where the engine stands could not be read: ${String(e?.body?.error || e?.message || e)}`));
      return;
    }
    paint();
  };

  /** @param {string} path @param {string} words */
  const job = async (path, words) => {
    busy = true;
    paint();
    try {
      await call(path, { method: "POST", body: {} });
      toast(words);
    } catch (/** @type {any} */ e) {
      toast(String(e?.body?.error || e?.message || e), "err");
    }
    busy = false;
    await read();
  };
  const uninstall = async () => {
    const again = !!status?.enabled && settingsAutoInstall !== false;
    const bundled = status?.engine?.bundle?.ready !== false;
    if (!(await ask({ title: "Remove memory's engine?", description: uninstallWords({ again, bundled }), confirmLabel: "Remove the engine", destructive: true }))) return;
    await job("/memory/uninstall", "Memory's engine removed");
  };
  const restart = async () => {
    busy = true;
    paint();
    await restartEngine({ api: call, toast });
    busy = false;
    await read();
  };

  function paint() {
    const e = status?.engine || {};
    const going = engineProgress(now) || (busy ? { line: "Working…" } : null);
    const missing = engineMissing(now || (e.installed ? null : { state: "missing", error: e.lastError || null, ...(e.bundle && !e.bundle.ready ? { why: e.bundle.why } : {}) }));
    const running = going || (status?.jobs || []).some((/** @type {any} */ j) => j.status === "running");
    const btn = (/** @type {string} */ label, /** @type {() => void} */ onclick, /** @type {string} */ cls = "", /** @type {string} */ title = "") =>
      m("button", { class: `ghost sm${cls ? ` ${cls}` : ""}`, type: "button", ...(title ? { title } : {}), ...(running ? { disabled: "" } : {}), onclick }, label);
    const other = otherEngine(e);
    const words = going
      ? going.line
      : e.installed
        ? `Mnemosyne ${e.version || "?"} in ${e.dir || "the engine folder"}${e.state ? ` · ${e.state}` : ""}.${other ? ` ${OTHER_ENGINE_WORDS}` : ""}${e.stalled ? ` ${stallWords(e.stalled)}` : ""}`
        : !status?.enabled
          ? `Memory is off; the engine can still be installed ahead of time. ${installWords(e.bundle)}`
          : missing && !missing.installable
            ? missing.note
            : `${missing?.note || "Its engine isn't installed."} ${installWords(e.bundle)}`;
    lineEl.replaceChildren(
      m("div", { class: "settings-row nset-row" },
        m("div", { class: "settings-row-text" },
          m("div", { class: "settings-row-label" }, "The engine"),
          m("div", { class: "settings-row-desc" }, words)),
        m("div", { class: "nset-acts" },
          // Only with the bundle here: without it, the words say why there is nothing to install.
          (!e.installed || other) && e.bundle?.ready ? btn("Install", () => void job("/memory/install", "Installing memory's engine…")) : null,
          e.installed && status?.enabled ? btn("Restart", () => void restart(), "", RESTART_WORDS) : null,
          e.installed ? btn("Uninstall", () => void uninstall(), "danger") : null)));
  }

  // An install's percent as the feed says it; its end is read again whole.
  const bus = io.bus || onBus;
  const undo = bus((/** @type {any} */ msg) => {
    if (body.isConnected === false) return void undo();
    if (msg?.type !== "engine" || !msg.engine) return;
    now = msg.engine;
    if (engineProgress(now)) paint();
    else void read();
  });

  void read();
  mountConfigPage(settingsEl, cb, io, {
    rows: (kit) => {
      settingsAutoInstall = kit.value("memory.engine.autoInstall");
      return [
        kit.field("memory.engine.embeddings", { label: "Recall by meaning" }),
        kit.head("Backups"),
        kit.field("memory.backups.enabled", { label: "Back up daily", desc: "A copy of the memory folder each day — the archive, the engine's database and memory.json — gzipped, with checksums." }),
        kit.field("memory.backups.folder", { label: "Backup folder" }),
        kit.field("memory.backups.hour", { label: "Hour of day" }),
        kit.field("memory.backups.keep", { label: "Backups kept" }),
        kit.head("Advanced"),
        kit.field("memory.folder", { label: "Memory folder" }),
      ].filter(Boolean);
    },
  });
}
