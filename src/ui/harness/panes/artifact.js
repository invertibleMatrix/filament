// @ts-check
// An artifact in the side pane, in a tab of its own (HarnessV4_Artifacts_Plan E18, step 2, AF-D35): a head with its
// mark, title, version and type, Open full (the full view, AF-D36) and the arrow that opens it in the browser, over its
// page in a frame (artifact-frame.js). The tab is the artifact's whatever chat is open: a page kept apart from the
// chat. Its head follows each new version, rename and pin, as the frame does; a deleted one's says so, and its frame
// shows its address's words (AFC-78). A page of Filament's own may fill the screen from it (AFC-112, AFC-127); a Doc's
// or a deck's text is edited in the full view, where there is room for the text beside the page (AFC-115).
import { h, setHtml } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { isTyped, markOf, titleOfName, typeWord } from "../lib/artifacts.js";
import { artifactFrame, artifactsPlaced, linkOut } from "../artifact-frame.js";
import { followRecord } from "../artifacts-live.js";

/**
 * @param {HTMLElement} body
 * @param {{ name: string, onTell: (text: string) => void, onAsk: (text: string) => void, onFull: (name: string) => void,
 *   onLabel: (label: string, icon: string) => void }} o  `onAsk`: what its page asks on a click, into the message box
 *   of the chat beside it (AF-D8); `onLabel`: its tab's words and mark, once its record is read
 */
export function renderArtifactPane(body, o) {
  const tile = h("span", { class: "artifact-tile sm", html: ICONS[markOf("")] || "" });
  const titleEl = h("span", { class: "artifact-title" }, titleOfName(o.name));
  const meta = h("span", { class: "artifact-meta" }, "Artifact");
  let type = "";
  const frame = artifactFrame(o.name, { title: titleOfName(o.name), onTell: o.onTell, onAsk: o.onAsk, mayFill: () => isTyped(type) });
  const full = h("button", { class: "visual-act", type: "button", title: "Open it full size, over the conversation", onclick: () => o.onFull(o.name) }, "Open full");
  const out = h("a", { class: "visual-act visual-copy", target: "_blank", rel: "noopener noreferrer", title: "Open it in your browser", "aria-label": "Open it in your browser", html: ICONS.externalLink });
  // Its address once this page knows where it reads artifacts — another machine's, its network address; none where
  // its Filament serves them on no network (artifact-frame.js).
  void artifactsPlaced()?.then(() => linkOut(out, frame.address));
  const head = h("div", { class: "artifact-pane-head" }, tile, h("span", { class: "artifact-words" }, titleEl, meta), h("span", { class: "artifact-acts" }, full, out));
  body.replaceChildren(h("div", { class: "artifact-pane", "data-artifact-tab": o.name }, head, frame.el));
  followRecord(head, o.name, (a) => {
    type = a.type;
    titleEl.textContent = a.title;
    setHtml(tile, ICONS[markOf(a.icon)] || "");
    meta.textContent = ["Artifact", `v${a.versions.length}`, typeWord(a.type)].join(" · ");
    frame.setTitle(a.title);
    o.onLabel(a.title, markOf(a.icon));
  }, (e) => {
    const err = /** @type {any} */ (e);
    if (err?.status === 410 && err.body?.title) {
      titleEl.textContent = err.body.title;
      o.onLabel(err.body.title, markOf(""));
    }
    meta.textContent = err?.status === 410 ? "Artifact · deleted" : `Artifact · it could not be read: ${String(err?.message || e).replace(/\.$/, "")}.`;
  });
}
