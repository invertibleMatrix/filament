// @ts-check
// What the developer does to an artifact (HarnessV4_Artifacts_Plan E18, step 4, AF-D13, AF-D14): pin it, rename it,
// download a version, copy its link, read its Info, make an old version the newest, delete it — from the Artifacts
// page's ⋮ and from its full view, in the same words in both. Each asks the admin API and says a refusal in the
// server's words; every view of it follows through the events stream (AFC-83).
import { h } from "../lib/dom.js";
import { api } from "./lib/api.js";
import { confirmDialog, dialog, toast } from "./lib/ui.js";
import { askingChat, dataWords, hereArtifactOf, passless, projectOf, readsWords, sizeWords, typeWord, versionLine } from "./lib/artifacts.js";
import { followRecord } from "./artifacts-live.js";

/** @typedef {import("./lib/artifacts.js").ArtifactSeen} ArtifactSeen */

/** An artifact's place in the admin API. @param {string} name */
const at = (name) => `/artifacts/${encodeURIComponent(name)}`;
/** A refusal's words, without their last stop. @param {unknown} e */
const said = (e) => String(/** @type {any} */ (e)?.message || e).replace(/\.$/, "");
/** A moment as Info says it. @param {number} ms */
const momentOf = (ms) => new Date(ms).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Pin it, or not (AFC-13). @param {ArtifactSeen} a @param {boolean} pinned */
export async function setPinned(a, pinned) {
  try {
    await api(at(a.name), { method: "PATCH", body: { pinned } });
  } catch (e) {
    toast(`${a.title} could not be ${pinned ? "pinned" : "unpinned"}: ${said(e)}.`, "err");
  }
}

/**
 * Rename it, on a dialog: its address stays (AFC-32); an empty or long title is refused in words (AFC-80).
 * @param {ArtifactSeen} a
 */
export function renameArtifact(a) {
  const input = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input", type: "text", value: a.title, "aria-label": "Its title" }));
  const why = h("p", { class: "artifact-why hidden", role: "alert" });
  const save = async () => {
    try {
      await api(at(a.name), { method: "PATCH", body: { title: input.value } });
      d.close();
    } catch (e) {
      why.textContent = `${said(e)}.`;
      why.classList.remove("hidden");
      input.focus();
    }
  };
  const d = dialog({
    title: "Rename artifact",
    description: "Its address stays as it is, so a link to it still opens it.",
    body: h("div", { class: "flex flex-col gap-2" }, input, why),
    actions: [
      { label: "Cancel", variant: "outline", onClick: () => d.close() },
      { label: "Rename", onClick: () => void save() },
    ],
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    }
  });
  input.focus();
  input.select();
}

/**
 * Delete it, asked first (AF-D14, AFC-46): every version and file goes; its address says it was deleted. Whether it
 * was deleted. @param {ArtifactSeen} a @returns {Promise<boolean>}
 */
export async function deleteArtifact(a) {
  const yes = await confirmDialog({
    title: `Delete “${a.title}”?`,
    description: "Every version and file of it goes, and its address will say it was deleted. The chats it was made in stay. This cannot be undone.",
    confirmLabel: "Delete",
    destructive: true,
  });
  if (!yes) return false;
  try {
    await api(at(a.name), { method: "DELETE" });
    toast(`Deleted ${a.title}`);
    return true;
  } catch (e) {
    toast(`${a.title} could not be deleted: ${said(e)}.`, "err");
    return false;
  }
}

/**
 * Make an old version the newest (AFC-28, AFC-79): its files as the next version, made by you. Whether it was.
 * @param {ArtifactSeen} a @param {number} v @returns {Promise<boolean>}
 */
export async function makeNewest(a, v) {
  try {
    await api(`${at(a.name)}/newest`, { method: "POST", body: { v } });
    toast(`v${v} of ${a.title} is the newest again`);
    return true;
  } catch (e) {
    toast(`v${v} could not be made the newest: ${said(e)}.`, "err");
    return false;
  }
}

/**
 * Download a version, the newest where none is named (AF-D13, AFC-48, AFC-82): a page alone as its HTML, with files
 * beside it a .zip — saved under the name the server gives it.
 * @param {ArtifactSeen} a @param {number} [v]
 */
export async function downloadArtifact(a, v) {
  try {
    const r = await fetch(`/api${at(a.name)}/download${v ? `?v=${v}` : ""}`, { headers: { "x-filament-ui": "1" } });
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || r.statusText);
    const file = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "")?.[1] || `${a.name}.html`;
    const url = URL.createObjectURL(await r.blob());
    const link = h("a", { href: url, download: file, class: "hidden" });
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    toast(`${a.title} could not be downloaded: ${said(e)}.`, "err");
  }
}

/**
 * An address of an artifact's that leaves this page, as it goes: where this page's addresses carry its pass for every
 * artifact (lib/artifacts.js `hereArtifactOf`), under one of that artifact's own the server gives (POST
 * /api/artifacts/:name/pass), the path inside it kept; else as it is. One the server gives none for is said, and
 * none. @param {string} address @returns {Promise<string>}
 */
export async function addressOut(address) {
  const here = hereArtifactOf(address);
  if (!here) return address;
  try {
    const at = String((await api(`/artifacts/${encodeURIComponent(here.name)}/pass`, { method: "POST", body: { still: here.still } }))?.address || "");
    if (at) return `${at.replace(/\/$/, "")}${here.path}`;
  } catch (e) {
    toast(`Its address could not be given: ${said(e)}.`, "err");
    return "";
  }
  return address;
}
/**
 * An address opened in a tab of its own, with no opener: an artifact's here under its own pass once the server gives
 * it (`addressOut`), any other at once, as pressed. @param {string} address
 */
export function openOut(address) {
  const go = (/** @type {string} */ to) => void (to && window.open(to, "_blank", "noopener,noreferrer"));
  if (!hereArtifactOf(address)) return go(address);
  void addressOut(address).then(go);
}

/** Copy its address, under its own pass where it needs one (`addressOut`). @param {ArtifactSeen} a @param {string} address  at the port this page is served on */
export async function copyLink(a, address) {
  const to = await addressOut(address);
  if (!to) return;
  navigator.clipboard?.writeText(to).then(() => toast(`Copied the link to ${a.title}`), (e) => toast(`The link could not be copied: ${said(e)}.`, "err"));
}

/**
 * Its Info (AFC-49): where it lives, what it is, when it was made, changed and last opened, what its page keeps — each
 * collection with its count, following each write while Info is open (AFC-97) — which of Filament's own numbers a
 * Dashboard reads (AFC-128), and each version with who made it and how much room it takes.
 * @param {ArtifactSeen} a @param {string} address
 */
export function showInfo(a, address) {
  const day = (/** @type {number} */ ms) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const all = a.versions.reduce((n, v) => n + (v.bytes || 0), 0);
  const row = (/** @type {string} */ k, /** @type {string | Node} */ v) => h("div", { class: "artifact-info-row" }, h("span", { class: "artifact-info-k" }, k), h("span", { class: "artifact-info-v" }, v));
  const kept = h("span", {}, dataWords(a.data));
  followRecord(kept, a.name, (x) => void (kept.textContent = dataWords(x.data)), (e) => void (kept.textContent = `it could not be read: ${said(e)}.`));
  const body = h("div", { class: "artifact-info" },
    row("Address", h("a", { href: String(passless(address)), target: "_blank", rel: "noopener noreferrer" }, String(passless(address)))),
    row("Type", typeWord(a.type)),
    row("Project", a.folder ? h("span", { title: a.folder }, projectOf(a.folder)) : "none named"),
    row("Made", momentOf(a.createdAt)),
    row("Changed", momentOf(a.updatedAt)),
    row("Last opened", a.viewedAt ? momentOf(a.viewedAt) : "never"),
    row("Data", kept),
    ...(a.reads?.length ? [row("Reads", readsWords(a.reads))] : []),
    row("Room", `${sizeWords(all)} in all, over ${a.versions.length} version${a.versions.length === 1 ? "" : "s"}`),
    h("div", { class: "artifact-info-versions" },
      ...[...a.versions].reverse().map((v) =>
        h("div", { class: "artifact-info-version" },
          h("span", { class: "artifact-info-v" }, versionLine(v, a.chats, day)),
          h("span", { class: "artifact-info-k" }, `${v.files || 0} file${v.files === 1 ? "" : "s"} · ${sizeWords(v.bytes || 0)}`)))));
  const d = dialog({ title: a.title, description: a.description || "", body, wide: true, actions: [{ label: "Close", variant: "outline", onClick: () => d.close() }] });
}

/**
 * The ⋮ menu's items for an artifact. `open`: the list's Open (the full view); `inView`: the full view's own menu,
 * whose head already holds Pin, Open in browser and Download.
 * @param {ArtifactSeen} a @param {string} address
 * @param {{ open?: () => void, inView?: boolean, onSession: (chain: string) => void, onDeleted?: () => void }} o
 */
export function artifactItems(a, address, o) {
  const chain = askingChat(a);
  return [
    o.open ? { label: "Open", icon: "maximize", onClick: o.open } : null,
    // No address — its Filament serves artifacts to this page on no network —: no link to open or copy.
    o.inView || !address ? null : { label: "Open in browser", icon: "externalLink", onClick: () => void openOut(address) },
    address ? { label: "Copy link", icon: "link", onClick: () => void copyLink(a, address) } : null,
    o.inView ? null : { label: a.pinned ? "Unpin" : "Pin", icon: "pin", onClick: () => void setPinned(a, !a.pinned) },
    { label: "Rename…", icon: "pencil", onClick: () => renameArtifact(a) },
    o.inView ? null : { label: "Download", icon: "download", onClick: () => void downloadArtifact(a) },
    { label: "Info", icon: "info", onClick: () => showInfo(a, address) },
    chain
      ? { label: "The session that made it", icon: "messageSquare", onClick: () => o.onSession(chain) }
      : { label: "The session that made it", icon: "messageSquare", desc: "it was deleted", disabled: true },
    { type: "separator" },
    { label: "Delete…", icon: "trash2", variant: "destructive", onClick: () => void deleteArtifact(a).then((done) => done && o.onDeleted?.()) },
  ].filter(Boolean);
}
