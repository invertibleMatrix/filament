// @ts-check
// Shared dashboard runtime. Pages and components read `ui` at call time (never at module load),
// so app.js can fill it after helpers exist without circular imports. The harness page does not
// import this — admin chrome and the mutable bag stay here.

/** Traffic filter defaults. The only place they are written down; callers use setReqFilter. */
export const REQ_FILTER_DEFAULTS = {
  status: "all",
  upstream: "",
  q: "",
  changed: false,
  limit: 100,
  group: true,
  tab: "requests",
  source: "",
  purpose: "",
};

export const state = {
  tab: "overview",
  homePane: "status",
  schema: null,
  config: null,
  saved: null,
  dirty: false,
  requests: [],
  ops: [],
  opKinds: null,
  templates: [],
  summary: null,
  live: true,
  meta: null,
  /** The coding agents' accounts, as the server last said them (HarnessV3-ACP AC3-6). */
  accounts: /** @type {import("./lib/accounts.js").AgentRow[]} */ ([]),
};

/**
 * Filled by `bindUi` once the shell has its helpers. Pages destructure this at the start of a
 * view function so they see the live bindings.
 * @type {any}
 */
export const ui = { state, REQ_FILTER_DEFAULTS };

/** @param {Record<string, any>} fns */
export function bindUi(fns) {
  Object.assign(ui, fns);
}

export function setReqFilter(patch = {}) {
  state.reqFilter = { ...REQ_FILTER_DEFAULTS, ...(state.reqFilter || {}), ...patch };
  return state.reqFilter;
}

ui.setReqFilter = setReqFilter;
