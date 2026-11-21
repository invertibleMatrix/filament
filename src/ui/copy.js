// @ts-check
// Clipboard and secret-display widgets. Shared by Settings, Setup, Destinations.

import { h } from "./lib/dom.js";
import { ui } from "./runtime.js";

const COPY = {
  copy: "Copy",
  copied: "Copied",
  blocked: "Clipboard blocked by the browser",
  show: "Show the key",
  hide: "Hide the key",
};

/** Shell chrome. index.html carries the same words as a no-JS fallback; boot overwrites from here. */
export const CHROME = {
  connecting: "connecting…",
  unsaved: "Unsaved changes",
  discard: "Discard",
  discardTitle: "Throw away the unsaved edits and show the saved configuration again",
  save: "Save changes",
  saved: "Saved",
  appearance: "Appearance",
  collapseNav: "Collapse sidebar",
  expandNav: "Expand sidebar",
};

export function copyBtn(text, label = COPY.copy) {
  return h(
    "button",
    {
      class: "sm ghost",
      title: "Copy to clipboard",
      onclick: (e) => {
        navigator.clipboard?.writeText(text).then(
          () => {
            e.target.textContent = COPY.copied;
            setTimeout(() => (e.target.textContent = label), 1200);
          },
          () => ui.toast(COPY.blocked, "err"),
        );
      },
    },
    label,
  );
}

export function copyline(text, cls = "") {
  return h("span", { class: "copyline" }, h("code", { class: cls }, text), copyBtn(text));
}

function eyeIcon(open) {
  return h("span", {
    html: open
      ? '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2.4"/><path d="M4 16L16 4"/></svg>'
      : '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2.4"/></svg>',
  });
}

export function secretLine(text) {
  const { state } = ui;
  const t = String(text || "");
  const masked =
    t.length > 10 ? `${t.slice(0, 6)}${"•".repeat(Math.min(18, t.length - 6))}` : "•".repeat(Math.max(6, t.length));
  const code = h("code", { class: "secret" }, state.keyShown ? t : masked);
  const eye = h(
    "button",
    {
      class: "sm ghost eye-btn",
      title: state.keyShown ? COPY.hide : COPY.show,
      "aria-label": "show or hide the key",
      onclick: () => {
        state.keyShown = !state.keyShown;
        code.textContent = state.keyShown ? t : masked;
        eye.replaceChildren(eyeIcon(state.keyShown));
        eye.title = state.keyShown ? COPY.hide : COPY.show;
      },
    },
    eyeIcon(state.keyShown),
  );
  return h("span", { class: "copyline" }, code, eye, copyBtn(t));
}
