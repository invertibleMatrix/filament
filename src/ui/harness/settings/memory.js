// @ts-check
// Settings › Memory (HarnessV3-Memory M6-5; proposal_ux §4.16, phase 7): how memory behaves. Memory is core (the
// owner's of 11-09): nothing here turns it or a part of it off — its one off switch is Settings › Experimental's. A
// project left out of memory, and whether memory reads and searches its chats (memory-chats.js, HarnessV4_Settings_Plan
// HS-D47); its model — the composer's picker and an effort chip (the memory plan's m1): the one set is first for every
// memory call, unset each chat's compaction model else its own; Settings › Experimental names chats with it too; a row
// to Settings › Connect other apps, which gives other agents this memory (M7-D46); and its engine, recall by meaning,
// backups and folder (memory-engine.js, HS-4). What memory holds — its claims, each workspace's dossier, its questions,
// how models did — is kept for you across chats, so it is the Library's (library/memory.js): a row here opens it. Built
// with an injected `h`, `api` and model picker, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { routeFor } from "../lib/router.js";
import { createModelSelect } from "../composer/model.js";
import { effortChip } from "../lib/effort-chip.js";
import { row } from "./rows.js";
import { renderMemoryChats, SEARCH_ROWS as CHATS_ROWS } from "./memory-chats.js";
import { renderMemoryEngine, SEARCH_ROWS as ENGINE_ROWS } from "./memory-engine.js";

/** Settings search's words for the page (search.js, HS-D68): its own rows, then a project's and the engine's, each
 *  checked against its code by a test. */
export const SEARCH_ROWS = Object.freeze([
  { label: "Model", words: "memory model summarizer side learns with effort curator" },
  { label: "Other agents", words: "memory door mcp connect" },
  { label: "What memory holds", words: "claims memories dossier questions library browse" },
  ...CHATS_ROWS,
  ...ENGINE_ROWS,
]);

/** What memory's model does, under its row. */
export const SIDE_WORDS = "Memory reads each finished session with it, files what it teaches and curates each workspace; Settings › Experimental can have it name chats.";
/** What memory calls where no model is set. */
export const UNSET_WORDS = "Not set: each chat's compaction model, else the chat's own model";

/**
 * @param {HTMLElement} body
 * @param {{ onToast?: (msg: string, kind?: string) => void, getChain?: () => string | undefined }} [cb]
 * @param {{ h?: typeof h, api?: (path: string, o?: any) => Promise<any>, modelSelect?: typeof createModelSelect, bus?: typeof import("../lib/bus.js").onBus, menu?: any }} [io]
 *   `menu`: what opens the effort chip's menu
 */
export function renderMemory(body, cb = {}, io = {}) {
  const m = io.h || h;
  const call = io.api || api;
  const pickModel = io.modelSelect || createModelSelect;
  const toast = cb.onToast || (() => {});

  const st = {
    /** @type {any} */ models: null,
    /** The models a route answers, as the composer's picker offers them. @type {any[]} */ catalogue: [],
    /** The catalogue's families: the efforts each model takes, for the effort's chip. @type {any[]} */ families: [],
  };
  const modelsEl = m("div", { class: "mset-models" });

  /** @param {Record<string, string | boolean>} want */
  async function setModels(want) {
    try {
      const r = await call("/memory/models", { method: "POST", body: want });
      if (r?.models) st.models = r.models;
    } catch (/** @type {any} */ e) {
      toast(e?.body?.error || e?.message || String(e), "err");
    }
    paintModels();
  }

  function paintModels() {
    const md = st.models;
    if (!md) return modelsEl.replaceChildren();
    // Memory's model (the memory plan's m1): the one set is first for every memory call; not set, each chat's compaction
    // model, else the chat's own — never the cheapest by itself. No switch turns it off here (the owner's of 11-09):
    // one turned off elsewhere (`summarizer: "off"`) is said, and a pick, or Not set, has memory learn again. Its
    // effort is on a chip beside it, low where none is picked.
    const on = md.summarizer !== "off";
    const set = on ? String(md.summarizer || "") : "";
    const pick = pickModel({
      onChange: (name) => void setModels({ summarizer: name }),
      onUseDefault: () => void setModels({ summarizer: "" }),
      defaultDesc: UNSET_WORDS,
      blank: "Not set",
    });
    pick.el.setAttribute("aria-label", "Memory's model");
    pick.setModels(st.catalogue);
    pick.set(set);
    const chip = effortChip({
      label: "Memory's effort",
      value: md.effort || "",
      onChange: (level) => void setModels({ effort: level }),
      model: () => set || md.now || "",
      families: () => st.families,
      inherit: () => ({ level: "low", desc: "Memory reads and files what a session teaches; it does not solve" }),
      mk: m,
      ...(io.menu ? { menu: io.menu } : {}),
    });
    chip.el.hidden = !on;
    modelsEl.replaceChildren(
      row(
        "Model",
        !on
          ? "Off: memory learns nothing from finished sessions, and no chat is named by it. Pick a model, or Not set, and it learns again."
          : set
            ? `${SIDE_WORDS} It is first for every memory call.`
            : md.now
              ? `${UNSET_WORDS}; where no chat is named, ${md.now}. Pick one to give memory a model of its own.`
              : md.from === "none"
                ? `${UNSET_WORDS}, and none is one memory can call: pick one here, or chat on a model a provider serves (a coding agent's alone is none).`
                : `${UNSET_WORDS}. ${md.whyNone ? `${md.whyNone[0].toUpperCase()}${md.whyNone.slice(1)}.` : ""}`,
        m("div", { class: "mset-pick" }, pick.el, chip.el),
        { h: m },
      ),
    );
  }

  // A project left out of memory, and what memory does with its chats, first; then its model, the way to its door for
  // other agents — Settings › Connect other apps', where the other apps are (the owner's of 11-09) —, where what it
  // holds went, and its engine.
  const chatsEl = m("div", { class: "mset-chats" });
  const engineEl = m("div", { class: "mset-engine" });
  const agents = row(
    "Other agents",
    "Claude Code, Codex and any other agent can use this memory too: the command that gives them its door is in Connect other apps.",
    m("a", { class: "inst-link mset-connect", href: routeFor("settings", { section: "connect" }) }, "Settings › Connect other apps"),
    { h: m },
  );
  const holds = row(
    "What memory holds",
    "Its memories, each workspace's dossier, its questions and how models did there moved to the Library: what Filament keeps for you across chats.",
    m("a", { class: "inst-link mset-library", href: routeFor("library", { page: "memory" }) }, "Library › Memory"),
    { h: m },
  );
  body.replaceChildren(chatsEl, modelsEl, agents, holds, engineEl);
  renderMemoryChats(chatsEl, cb, io);
  renderMemoryEngine(engineEl, cb, io);
  call("/memory/models")
    .then(async (r) => {
      st.models = r.models;
      try {
        // The picker lists the routes' names alone (a pick is one); the families tell the effort's chip each one's levels.
        const c = await call("/models?all=1");
        st.catalogue = c?.models || c?.data || [];
        st.families = c?.families || [];
      } catch {}
      paintModels();
    })
    .catch(() => {});
}
