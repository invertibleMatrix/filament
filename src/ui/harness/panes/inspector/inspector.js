// @ts-check
// The Session inspector's own drawing (HarnessV2 §10.3, §14), beside the shared editor's knob sections (HarnessV3
// Step 2 D13, ui/lib/settings/editor.js): the dry-run turn. Every change is one PATCH to the session's own layer and
// lands on the next turn as a boundary row.
import { h } from "../../../lib/dom.js";
import { fmt } from "../../../lib/format.js";
import { dialog } from "../../lib/ui.js";
import { dryRunText, dryRunDraft } from "../../../lib/settings/knobs.js";

/**
 * @typedef {object} InspectorCallbacks
 * @property {(change: { patch?: any, unset?: string[] }) => void} change  PATCH the session's own layer
 * @property {() => Promise<any>} loadPreview  `GET /compose` (dry)
 * @property {(text: string) => Promise<any>} [loadPrompt]  `GET /compose?dry=1&prompt=1&text=` — the dry-run turn (§14)
 * @property {() => string} [draft]  the composer's draft, the dry run's newest user message
 * @property {() => Promise<any>} loadHistory  `GET /settings/history`
 * @property {() => Promise<any>} [loadInstructions]  `GET /instructions` — what the loop's prompt carries from the project (§5.4/5.5)
 * @property {(msg: string, kind?: string) => void} [toast]
 */

/**
 * The dry-run flow (§14), the Context widget's: the composer's draft, cut for the preview, composed by the session and
 * shown message by message.
 * @param {{ loadPrompt?: (text: string) => Promise<any>, draft?: () => string, toast?: (msg: string, kind?: string) => void }} cb
 */
export function openDryRun(cb) {
  const full = String(cb.draft?.() || "");
  const draft = dryRunDraft(full);
  cb.loadPrompt?.(draft).then((p) => dryRunDialog(p, { draft, cut: full.length > draft.length })).catch((e) => cb.toast?.(`dry run: ${String(e?.message || e)}`, "err"));
}

/**
 * The dry-run turn (§14): the request the composer would hand the pipeline for the draft in the composer, as the
 * model would receive it — every message in order, the draft newest — without sending anything. The card says what
 * the pipeline still adds on the way out (the loop's system prompt and tools, memory's recall).
 * @param {any} p  the `GET /compose?dry=1&prompt=1` answer @param {{ draft: string, cut: boolean }} about
 */
export function dryRunDialog(p, about) {
  const cur = p?.current || {};
  const prompt = cur.prompt || {};
  const messages = Array.isArray(prompt.messages) ? prompt.messages : [];
  const body = h("div", { class: "dry-run" },
    h("div", { class: "muted small" }, `${messages.length} message${messages.length === 1 ? "" : "s"} · ~${fmt.n(prompt.tokens ?? cur.tokens)} tokens${cur.head ? ` · turns ${cur.head.fromTurn}–${cur.head.toTurn} under a summary` : ""}${about.cut ? ` · the draft was cut to its first ${fmt.n(about.draft.length)} chars for this preview` : ""}`),
    prompt.added ? h("div", { class: "muted small" }, prompt.added) : null,
    // The composer's own notes — among them which turns folded because their tools have no equivalent here (D7),
    // said where the composed body is shown, not only in the record after a turn ran.
    Array.isArray(cur.notes) && cur.notes.length ? h("div", { class: "dry-run-notes" }, ...cur.notes.map((/** @type {string} */ n) => h("p", { class: "pane-note" }, n))) : null,
    ...(messages.length ? messages.map((m, i) => h("div", { class: `dry-msg role-${m?.role || "unknown"}${i === messages.length - 1 ? " is-draft" : ""}` },
      h("div", { class: "dry-role" }, `${m?.role || "?"}${i === messages.length - 1 ? " · the draft" : ""}`),
      h("pre", { class: "dry-text" }, dryRunText(m?.content) || (i === messages.length - 1 ? "(the composer is empty — type a draft to see it here)" : "")))) : [h("div", { class: "muted small" }, "nothing composed")]));
  const d = dialog({
    title: "Dry-run turn",
    wide: true,
    description: "what the composer would send for the draft below — nothing was sent, nothing recorded",
    body,
    actions: [
      { label: "Copy JSON", variant: "outline", onClick: () => { navigator.clipboard?.writeText(JSON.stringify(prompt.messages || [], null, 2)); } },
      { label: "Close", onClick: () => d.close() },
    ],
  });
  return d;
}
