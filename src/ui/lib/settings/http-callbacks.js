// @ts-check
// The shared editor's write path for the dashboard's surfaces (HarnessV3 Step 2 D13/D14): the session panel and
// the project panel hand these to settingsEditor. One call at a time, a toast for every answer, a reload after —
// the same contract the harness's context-callbacks keeps. The api is ui/lib/api.js's client.
import { api } from "../api.js";

/**
 * A session's editor callbacks, over the §5 rows.
 * @param {{ chainId: string, reload: () => void, toast: (msg: string, kind?: string) => void }} o
 * @returns {import("./editor.js").EditorCallbacks}
 */
export function sessionEditorCallbacks({ chainId, reload, toast }) {
  const id = encodeURIComponent(chainId);
  /** @param {() => Promise<string>} run */
  const act = async (run) => {
    try {
      toast(await run());
      reload();
    } catch (/** @type {any} */ e) {
      toast(String(e?.message || e), "err");
    }
  };
  return {
    change: ({ patch, unset }) => act(async () => {
      const r = await api(`/sessions/${id}/settings`, { method: "PATCH", body: { ...(patch ? { patch } : {}), ...(unset?.length ? { unset } : {}) } });
      return r.changes?.length ? `changed: ${r.changes.map((/** @type {any} */ c) => c.path).join(", ")} — in force from the next request` : "nothing changed";
    }),
    toast,
  };
}

/**
 * A project's editor callbacks (project mode): repo-knob writes.
 * @param {{ projectId: string, reload: () => void, toast: (msg: string, kind?: string) => void }} o
 * @returns {import("./editor.js").EditorCallbacks}
 */
export function projectEditorCallbacks({ projectId, reload, toast }) {
  const id = encodeURIComponent(projectId);
  /** @param {() => Promise<string>} run */
  const act = async (run) => {
    try {
      toast(await run());
      reload();
    } catch (/** @type {any} */ e) {
      toast(String(e?.message || e), "err");
    }
  };
  return {
    change: ({ patch, unset }) => act(async () => {
      const r = await api(`/projects/${id}/settings`, { method: "POST", body: { ...(patch ? { patch } : {}), ...(unset?.length ? { unset } : {}) } });
      return r.changes?.length ? `project: ${r.changes.map((/** @type {any} */ c) => c.path).join(", ")} changed — every session of the project inherits it` : "nothing changed";
    }),
    toast,
  };
}
