// @ts-check
// An app's ask (the owner's of 11-04: Summarize "opened new task with a chat message in the compose … automated agentic
// work … could run on that model without users having to open a chat all the time"): what an app's button asks an agent
// for — its page's `filament.ask` —, said in a sheet over the app before anything runs. The words, where it runs, the
// model it runs on with that model's effort — the Space's, changeable for this ask —, and two ways: Run it here, a chat
// of the Space at work in the background, reading only, while the person stays on the app; or Open in a chat, the Start
// in the Space with the words, nothing sent until they send. A model picked where the Space had none may become the
// Space's own, and "Run an app's asks here at once" stops the sheet asking. Only Run it runs anything.
import { h } from "../../lib/dom.js";
import { sheet } from "../lib/ui.js";
import { createModelSelect } from "../composer/model.js";
import { fitEffort, modelRow } from "./model-row.js";

/** How many of the words' lines show before Show all. */
const LINES_SHOWN = 6;

/**
 * The sheet, open. `run`: the run here on a model at an effort — its chat, or the refusal in words; `openChat`: the Start
 * in the Space with the words; `keep`: a change to the Space's own settings, its answer whether it was taken; `closed`:
 * told once the sheet goes, run or not.
 * @param {{ app: string, words: string, space: string, runsOn: import("../lib/space-settings.js").RunsOn,
 *   run: (model: string, effort: string) => Promise<{ ok: true, chain: string, on: string } | { ok: false, error: string }>,
 *   openChat: () => void, keep?: (patch: Record<string, string>) => Promise<boolean>, ran?: (chain: string, on: string) => void, closed?: () => void,
 *   catalogue?: import("./model-row.js").Catalogue, modelSelect?: typeof createModelSelect }} o
 */
export function askSheet({ app, words, space, runsOn, run, openChat, keep, ran, closed, catalogue, modelSelect = createModelSelect }) {
  let open = true;
  let running = false;
  /** @type {{ close: () => void } | null} */
  let s = null;
  const go = /** @type {HTMLButtonElement} */ (h("button", { class: "sm primary sak-run", type: "button" }, "Run it here"));
  const said = h("p", { class: "sak-said", role: "alert", hidden: "" });
  /** Whose the model shown is. @param {boolean} picked */
  const whose = (picked) =>
    picked ? "For this ask"
    : runsOn.from === "space" ? `${space}'s model`
    : runsOn.from === "default" ? "Every Space's model, from Settings › Space"
    : "";
  let picked = false;
  const keepModel = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", class: "sak-keep-model" }));
  const keepRow = h("label", { class: "sak-check", hidden: "" }, keepModel, ` Use it for ${space}'s agents from now on`);
  const atOnce = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", class: "sak-at-once" }));
  const atOnceRow = h("label", { class: "sak-check" }, atOnce, ` Run ${space}'s app asks at once from now on, without this sheet`);
  atOnceRow.hidden = !keep;
  const runs = modelRow({
    named: `The model ${app}'s ask runs on`,
    cls: "sak-why",
    catalogue,
    modelSelect,
    blank: "Choose a model",
    onPick: (model) => {
      picked = true;
      runs.show(model, whose(true), fitEffort(catalogue, model, runs.effort() || runsOn.effort));
      paint();
    },
    effort: {
      onPick: () => {
        picked = true;
        paint();
      },
      named: `The effort ${app}'s ask runs at`,
    },
    changed: () => paint(),
    alive: () => open,
  });
  /** Run it waits for a model that can run; Use it… is offered where the model is not the Space's own already. */
  function paint() {
    go.disabled = running || !runs.ready();
    go.title = running ? "Starting…" : !runs.model() ? "Choose a model it runs on first" : !runs.ready() ? "This model cannot run now: choose another" : "";
    // Untouched, the model shown is the Space's as it stands — its effort too, whatever this page's catalogue can show.
    keepRow.hidden = !keep || !runs.model() || (runsOn.from === "space" && (!picked || (runs.model() === runsOn.model && runs.effort() === runsOn.effort)));
  }
  runs.show(runsOn.model, runsOn.model ? whose(false) : `${space} has no model for its agents yet: choose one`, runsOn.effort);
  keepModel.checked = !runsOn.model;

  const lines = words.split(/\r?\n/);
  const more = lines.length > LINES_SHOWN;
  const text = h("p", { class: "srt-sheet-task sak-words" }, more ? `${lines.slice(0, LINES_SHOWN).join("\n")}\n…` : words);
  const all = more ? h("button", { class: "sb-more sak-all", type: "button", onclick: () => { text.textContent = words; all?.remove(); } }, `Show all ${lines.length} lines`) : null;
  const body = h("div", { class: "sdb-keep-body sak-body" },
    h("p", { class: "sdb-keep-lead" }, `Nothing has run yet. Run it here and an agent works on it in the background, reading only — it may still write ${app}'s own data —, as a chat of ${space} you can open; or open it in a chat to read and change the words first.`),
    h("h4", { class: "sdb-keep-h" }, "What it asks"),
    h("div", { class: "srt-sheet-v" }, text, ...(all ? [all] : [])),
    h("h4", { class: "sdb-keep-h" }, "Runs on"),
    h("div", { class: "srt-sheet-v" }, runs.row, keepRow),
    ...(keep ? [h("div", { class: "srt-sheet-v sak-once" }, atOnceRow)] : []),
    said);
  go.addEventListener("click", async () => {
    if (go.disabled) return;
    running = true;
    said.hidden = true;
    paint();
    const model = runs.model();
    // The Space's own effort where its model was not changed here — the server fits it to what the model takes, where
    // this page's catalogue cannot say —; the one picked here where it was.
    const effort = picked ? runs.effort() : runsOn.effort;
    // What the person said to keep, kept first: the run is on the model either way.
    if (keep && !keepRow.hidden && keepModel.checked) await keep({ model, effort });
    if (keep && atOnce.checked) await keep({ asks: "run" });
    const got = await run(model, effort);
    running = false;
    if (got.ok) {
      s?.close();
      ran?.(got.chain, got.on);
      return;
    }
    said.textContent = got.error;
    said.hidden = false;
    paint();
  });
  const foot = h("div", { class: "sdb-keep-foot" },
    h("button", { class: "ghost sm sak-chat", type: "button", title: `The Start in ${space} with these words: nothing runs until you send`, onclick: () => { s?.close(); openChat(); } }, "Open in a chat"),
    h("span", { class: "sb-sp" }),
    h("button", { class: "ghost sm", type: "button", onclick: () => s?.close() }, "Not now"),
    go);
  paint();
  const title = `${app} asks an agent`;
  s = sheet({ label: title, class: "sdb-keep-sheet sak-sheet", head: h("b", { class: "sp-sheet-title" }, title), body, foot, onClose: () => { open = false; closed?.(); } });
  return { close: () => s?.close() };
}
