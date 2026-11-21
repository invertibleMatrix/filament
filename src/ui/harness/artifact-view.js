// @ts-check
// An artifact's full view (HarnessV4_Artifacts_Plan E18, step 2, AF-D36): its page over the whole of the
// conversation's frame, as Settings and a control room lie over it, under a head that says what it is — its mark,
// title, newest version, when and in which chat it was made, by which model, whether its page keeps data (AFC-97), and
// which of Filament's own numbers a Dashboard reads (AFC-128).
// Step 4 gives it the developer's hand: Versions, where an old one opens labelled and can be made the newest again
// (AFC-28); Pin, Open in browser, Download and ⋮ (rename, copy its link, Info, the session that made it, delete); and
// Ask for a change, which writes into the message box of the chat that made it (AF-D16, AFC-84) — as does what its
// page asks on a click (AF-D8). A Doc or a deck has Edit: its text beside its page, Save and Cancel in the head
// (step 6, artifact-edit.js, AFC-115). Back goes where it was opened from: the Artifacts page or the chat. A deleted
// one says so, and its page shows its address's words (AFC-78).
import { h, setHtml } from "../lib/dom.js";
import { ICONS } from "./lib/icons.js";
import { menu } from "./lib/ui.js";
import { askingChat, askWords, dataWords, isEditable, isTyped, keepsWords, madeLine, markOf, readsWords, titleOfName, versionAddress, versionBy, versionLine, portOf } from "./lib/artifacts.js";
import { artifactItems, downloadArtifact, makeNewest, setPinned } from "./artifact-acts.js";
import { artifactEditor, hasDraft } from "./artifact-edit.js";
import { artifactFrame, artifactsPlaced, linkOut } from "./artifact-frame.js";
import { followRecord } from "./artifacts-live.js";

/** @typedef {import("./lib/artifacts.js").ArtifactSeen} ArtifactSeen */

/** A moment as the head says it: its day, and its time. @param {number} ms */
const dayOf = (ms) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * @param {HTMLElement} host  the conversation's frame
 * @param {string} name
 * @param {{ fromList: boolean, onClose: () => void, onTell: (text: string) => void,
 *   onAsk: (chain: string | null, words: string) => void, onSession: (chain: string) => void }} o
 *   `fromList`: opened from the Artifacts page, which Back goes to; `onAsk`: the words, into that chat's message box —
 *   a new task's where no chat is left, or none is known yet
 */
export function renderArtifactView(host, name, o) {
  const had = /** @type {HTMLElement | null} */ (host.querySelector(".artifact-view"));
  if (had?.dataset.artifactView === name) return;
  had?.remove();
  /** @type {ArtifactSeen | null} */
  let record = null;
  /** The version shown, where it is an old one; null for the newest. @type {number | null} */
  let shownV = null;
  let gone = false;

  const tile = h("span", { class: "artifact-tile", html: ICONS[markOf("")] || "" });
  const titleEl = h("span", { class: "artifact-title" }, titleOfName(name));
  const meta = h("span", { class: "artifact-meta" }, "Artifact");
  // What its page asks on a click goes where Ask for a change does, as the page wrote it (AF-D8, AFC-98). A page of
  // Filament's own may fill the screen (AFC-112); a Doc or a deck is sent the text being edited beside it again each
  // time it loads.
  const frame = artifactFrame(name, {
    title: titleOfName(name),
    onTell: o.onTell,
    onAsk: (text) => o.onAsk(record ? askingChat(record) : null, text),
    mayFill: () => isTyped(record?.type),
    onReady: () => editor.again(),
  });
  const editor = artifactEditor(name, { draft: frame.draft, onLeave: () => leaveEdit(), onChange: () => paint() });
  const act =(/** @type {keyof typeof ICONS} */ ic, /** @type {string} */ words, /** @type {string} */ title) =>
    /** @type {HTMLButtonElement} */ (h("button", { class: "visual-act", type: "button", title }, h("span", { class: "artifact-act-ic", html: ICONS[ic] }), words));
  const back = act("chevronLeft", o.fromList ? "Artifacts" : "Back", o.fromList ? "Back to the Artifacts page" : "Back to the chat");
  back.addEventListener("click", () => o.onClose());
  const editBtn = act("pencil", "Edit", "Edit its text beside it; Save keeps it as a new version, by you");
  const versionsBtn = /** @type {HTMLButtonElement} */ (h("button", { class: "visual-act", type: "button", title: "Its versions" }, "Versions", h("span", { class: "artifact-act-ic", html: ICONS.chevronDown })));
  const pinBtn = act("pin", "Pin", "Pin it: the Artifacts page's Pinned lists it");
  const out = /** @type {HTMLAnchorElement} */ (h("a", { class: "visual-act", target: "_blank", rel: "noopener noreferrer", title: "Open it in your browser" }, h("span", { class: "artifact-act-ic", html: ICONS.externalLink }), "Open in browser"));
  const down = act("download", "Download", "Download the version shown: a page as its HTML, with files beside it a .zip");
  const moreBtn = /** @type {HTMLButtonElement} */ (h("button", { class: "visual-act visual-copy", type: "button", title: "More", "aria-label": "More", html: ICONS.ellipsis }));
  const acts = h("span", { class: "artifact-acts artifact-view-acts" }, editBtn, versionsBtn, pinBtn, out, down, moreBtn);
  const cancelBtn = h("button", { class: "visual-act", type: "button", title: "Leave Edit; asked first where you changed something" }, "Cancel");
  const saveBtn = /** @type {HTMLButtonElement} */ (h("button", { class: "visual-act artifact-save", type: "button", title: "Keep it as the next version, by you" }, "Save"));
  const editActs = h("span", { class: "artifact-acts artifact-view-acts hidden" }, cancelBtn, saveBtn);
  cancelBtn.addEventListener("click", () => void editor.cancel());
  saveBtn.addEventListener("click", () => void editor.save(false));
  const head = h("div", { class: "artifact-view-head" }, back, tile, h("span", { class: "artifact-words" }, titleEl, meta), acts, editActs);

  const oldWords = h("span", { class: "artifact-note-text" });
  const newestBtn = act("history", "Make this the newest", "Publish this version again, as the newest; the chats that made it read it next");
  const backToNewest = act("arrowUp", "Show the newest", "Show the newest version");
  const oldBar = h("div", { class: "artifact-old hidden", role: "status" }, oldWords, newestBtn, backToNewest);

  const askIn = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input artifact-ask-in", type: "text", placeholder: "Say what should change", "aria-label": "Ask for a change" }));
  const askWhere = h("span", { class: "artifact-ask-label" }, "Ask for a change");
  const askBar = h("form", { class: "artifact-ask" }, askWhere, askIn,
    h("button", { class: "visual-act", type: "submit", title: "Write it into the message box of the chat that made it; nothing is sent until you send it" }, h("span", { class: "artifact-act-ic", html: ICONS.cornerDownLeft }), "Ask"));
  askBar.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!record || !askIn.value.trim()) return;
    o.onAsk(askingChat(record), askWords(record.title, askIn.value));
    askIn.value = "";
  });

  const view = h("div", { class: "artifact-view", "data-artifact-view": name }, head, oldBar, h("div", { class: "artifact-view-body" }, editor.el, frame.el), askBar);
  host.append(view);

  /** Edit its text beside its page (AFC-115), from the newest version. */
  const edit = async () => {
    const a = record;
    if (!a || gone || !isEditable(a.type) || editor.open) return;
    if (shownV) show(null);
    if (await editor.begin(a)) paint();
  };
  /** Back to its page alone, as it stands. */
  const leaveEdit = () => {
    frame.showVersion(null);
    paint();
  };
  editBtn.addEventListener("click", () => void edit());

  /** Where Open in browser goes: the version shown, at the address this page reads its artifacts at. */
  const outHref = () => (shownV ? versionAddress(name, portOf(location), shownV) : frame.address);
  // …which the server says once read: another machine's browser opens the network's artifacts address.
  let placed = false;
  void artifactsPlaced().then(() => {
    placed = true;
    linkOut(out, outHref());
  });
  /** Show a version: an old one labelled, or the newest (null). @param {number | null} v */
  const show = (v) => {
    shownV = v && record && v < record.versions.length ? v : null;
    frame.showVersion(shownV);
    if (placed) linkOut(out, outHref());
    paint();
  };
  const paint = () => {
    const a = record;
    const editing = editor.open;
    view.classList.toggle("is-editing", editing);
    acts.classList.toggle("hidden", editing);
    editActs.classList.toggle("hidden", !editing);
    saveBtn.disabled = editor.saving;
    for (const el of [versionsBtn, pinBtn, out, down, moreBtn, askBar]) el.classList.toggle("hidden", gone || !a || editing);
    editBtn.classList.toggle("hidden", gone || !a || !isEditable(a.type) || !!shownV);
    if (gone || !a) {
      oldBar.classList.add("hidden");
      return;
    }
    titleEl.textContent = a.title;
    setHtml(tile, ICONS[markOf(a.icon)] || "");
    const reads = readsWords(a.reads);
    meta.textContent = ["Artifact", madeLine(a, dayOf), keepsWords(a.data), reads ? `reads ${reads}` : ""].filter(Boolean).join(" · ");
    meta.title = [a.data?.length ? `It keeps ${dataWords(a.data)}.` : "", reads ? `Its tiles read ${reads}, as they change; nothing writes to them.` : ""].filter(Boolean).join(" ");
    frame.setTitle(a.title);
    pinBtn.replaceChildren(h("span", { class: "artifact-act-ic", html: ICONS.pin }), a.pinned ? "Unpin" : "Pin");
    pinBtn.setAttribute("aria-pressed", String(a.pinned));
    pinBtn.classList.toggle("on", a.pinned);
    const old = shownV && !editing ? a.versions[shownV - 1] : null;
    oldWords.textContent = old ? `You are looking at v${old.v} of ${a.versions.length}, an old version: ${versionLine(old, a.chats, dayOf)}.` : "";
    oldBar.classList.toggle("hidden", !old);
    const chain = askingChat(a);
    askWhere.textContent = chain ? "Ask for a change" : "Ask for a change, in a new chat";
  };

  versionsBtn.addEventListener("click", () => {
    const a = record;
    if (!a) return;
    const newest = a.versions.length;
    menu([...a.versions].reverse().map((v) => ({
      type: "radio",
      label: `v${v.v} · ${dayOf(v.at)}${v.v === newest ? " · the newest" : ""}`,
      desc: versionBy(v, a.chats),
      checked: (shownV ?? newest) === v.v,
      onClick: () => show(v.v),
    })), { anchor: versionsBtn, align: "end", width: 360 });
  });
  pinBtn.addEventListener("click", () => record && void setPinned(record, !record.pinned));
  down.addEventListener("click", () => record && void downloadArtifact(record, shownV || undefined));
  moreBtn.addEventListener("click", () => {
    if (record) menu(artifactItems(record, frame.address, { inView: true, onSession: o.onSession }), { anchor: moreBtn, align: "end", width: 220 });
  });
  newestBtn.addEventListener("click", () => {
    const a = record;
    const v = shownV;
    if (a && v) void makeNewest(a, v).then((done) => done && show(null));
  });
  backToNewest.addEventListener("click", () => show(null));

  followRecord(head, name, (a) => {
    const first = !record;
    record = a;
    gone = false;
    if (shownV && shownV >= a.versions.length) shownV = null;
    editor.record(a);
    paint();
    // Text typed for it before, and not saved, opens it in Edit again (AFC-117).
    if (first && hasDraft(name)) void edit();
  }, (e) => {
    const err = /** @type {any} */ (e);
    gone = err?.status === 410;
    if (gone) editor.gone();
    if (gone && err.body?.title) {
      titleEl.textContent = err.body.title;
      frame.setTitle(err.body.title);
    }
    meta.textContent = gone ? "Artifact · deleted" : `Artifact · it could not be read: ${String(err?.message || e).replace(/\.$/, "")}.`;
    meta.title = "";
    paint();
  });
}
