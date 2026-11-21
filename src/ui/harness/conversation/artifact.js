// @ts-check
// A page an agent published, as its card in the answer (HarnessV4_Artifacts_Plan E18, step 2, AF-D34): its mark, the
// word that it is an artifact — so it is never taken for part of the harness — its title, the version its call made
// and how many there are now (AFC-65), its type and its description. Open puts it in the side pane (AF-D35); the
// arrow opens it on its own address in the browser. One that cannot be read says why in its place (AFC-66); one
// deleted says so, by its title, and opens nothing (AFC-78).
import { h, setHtml } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { whenShown } from "../lib/when-shown.js";
import { artifactAddress, markOf, portOf, typeWord, versionWords } from "../lib/artifacts.js";
import { followRecord } from "../artifacts-live.js";
import { artifactsPlaced, linkOut } from "../artifact-frame.js";

/** @typedef {import("../artifacts-live.js").ArtifactRecord} ArtifactRecord */
/** @typedef {{ onOpen: (name: string) => void }} ArtifactHears  Open: the artifact in the side pane */

/**
 * An artifact's card, for the version one call published.
 * @param {{ id: string, name: string, v: number, title: string, icon?: string, type?: string }} at  the call's id, the
 *   artifact, the version it made, and what the page knows of it before its record is read
 * @param {ArtifactHears} hears
 */
export function artifactCard(at, hears) {
  const tile = h("span", { class: "artifact-tile", html: ICONS[markOf(at.icon)] || "" });
  const titleEl = h("span", { class: "artifact-title" }, at.title || at.name);
  const meta = h("span", { class: "artifact-meta" });
  const desc = h("span", { class: "artifact-desc hidden" });
  const open = /** @type {HTMLButtonElement} */ (h("button", { class: "visual-act", type: "button", title: "Open it in the side pane" }, "Open"));
  const out = h("a", { class: "visual-act visual-copy hidden", target: "_blank", rel: "noopener noreferrer", title: "Open it in your browser", "aria-label": "Open it in your browser", html: ICONS.externalLink });
  // Its address as the server says this page reads its artifacts: another machine's browser opens the network's, and
  // none where its Filament serves them on no network. "" until the server has said.
  let address = "";
  /** The link out: where it has an address, and opens while its record reads. */
  const linked = () => linkOut(out, open.disabled ? "" : address);
  void artifactsPlaced().then(() => {
    address = artifactAddress(at.name, portOf(location));
    linked();
  });
  const el = h("div", { class: "artifact-card", "data-artifact": at.name, "data-call": at.id },
    tile,
    h("span", { class: "artifact-words" }, titleEl, meta, desc),
    h("span", { class: "artifact-acts" }, open, out));
  open.onclick = () => hears.onOpen(at.name);
  // The card itself opens it, as its button does; its link and button keep their own clicks.
  el.addEventListener("click", (e) => {
    if (open.disabled || /** @type {Element} */ (e.target).closest?.("a, button")) return;
    hears.onOpen(at.name);
  });

  /** Its words from what is known: the record once read, else the call's. @param {ArtifactRecord | null} a */
  const paint = (a) => {
    titleEl.textContent = a?.title || at.title || at.name;
    setHtml(tile, ICONS[markOf(a?.icon ?? at.icon)] || "");
    meta.textContent = ["Artifact", versionWords(at.v, a?.versions.length || 0), typeWord(a?.type ?? at.type)].join(" · ");
    desc.textContent = a?.description || "";
    desc.classList.toggle("hidden", !a?.description);
  };
  /**
   * Its record could not be read: why — or that it was deleted — in place of its words, and nothing to open.
   * @param {unknown} e
   */
  const unread = (e) => {
    const err = /** @type {any} */ (e);
    if (err?.status === 410 && err.body?.title) titleEl.textContent = err.body.title;
    meta.textContent = err?.status === 410 ? "Artifact · deleted" : `Artifact · it could not be read: ${String(err?.message || e).replace(/\.$/, "")}.`;
    desc.classList.add("hidden");
    open.disabled = true;
    linked();
    el.classList.add("is-unread");
  };
  const read = (/** @type {ArtifactRecord} */ a) => {
    open.disabled = false;
    linked();
    el.classList.remove("is-unread");
    paint(a);
  };
  paint(null);
  // Read as it nears the screen, and again for each new version (AF-D37): "v1 · 3 versions" (AFC-65).
  whenShown(el, () => followRecord(el, at.name, read, unread));
  return { el };
}
