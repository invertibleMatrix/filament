// @ts-check
// The settings document's write path, shared by every surface that edits it (Overview's setup sheets, the Next
// request pane). One PATCH at a time, a toast for every answer, a reload after — the contract the inspector always had.
import { api } from "./lib/api.js";

/**
 * @param {{ chainIdOf: () => string | null, docOf?: () => any, reload: () => void, onToast: (msg: string, kind?: string) => void, draft?: () => string }} o
 * @returns {import("../lib/settings/editor.js").EditorCallbacks & { loadPreview: () => Promise<any>, loadPrompt: (text: string) => Promise<any>, loadHistory: () => Promise<any>, loadInstructions: () => Promise<any> }}
 */
export function createInspectorCallbacks({ chainIdOf, docOf, reload, onToast, draft }) {
  /** One call against the session, then a reload; the toast says what happened. @param {() => Promise<string>} run */
  const act = async (run) => {
    const id = chainIdOf();
    if (!id) return;
    try {
      onToast(await run());
      reload();
    } catch (e) {
      onToast(String(/** @type {any} */ (e)?.message || e), "err");
    }
  };
  const path = () => `/sessions/${encodeURIComponent(String(chainIdOf()))}`;
  return {
    change: async (change) => {
      const id = chainIdOf();
      if (!id) return;
      try {
        const r = await api(`/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: change });
        onToast(r.changes?.length ? `Changed: ${r.changes.map((/** @type {any} */ c) => c.path).join(", ")}, in force from the next turn` : "Nothing changed");
        reload();
      } catch (e) {
        onToast(String(/** @type {any} */ (e)?.message || e), "err");
      }
    },
    loadPreview: () => api(`${path()}/compose?dry=1`),
    loadPrompt: (text) => api(`${path()}/compose?dry=1&prompt=1&text=${encodeURIComponent(text)}`),
    draft: () => draft?.() || "",
    loadHistory: () => api(`${path()}/settings/history`),
    loadInstructions: () => api(`${path()}/instructions`),
    toast: onToast,
  };
}
