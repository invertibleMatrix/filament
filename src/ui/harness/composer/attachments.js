// @ts-check
// Attachments: up to 10, each 20 MB or smaller. Images and PDFs go as base64 blocks (`attachmentBlock`) — the server
// gives a PDF to a model that reads PDFs as it is and to any other as its text —, text files as fenced text. A picture
// past what a provider takes in one (PICTURE_MAX_BYTES) is drawn smaller in the page first (`fitPicture`), its card
// saying so; one that would take the message past what Filament takes in one request (`most`) is refused in words. A
// box whose sends hand agents pictures alone (the Side tab's) refuses a PDF in words. The drop overlay names what is
// being dropped.
import { h } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { tokenWords } from "../lib/beside.js";

const MAX_FILES = 10;
const MAX_BYTES = 20 * 1024 * 1024;
/**
 * The most a picture may be as Anthropic takes one: 5 MB of base64, 3.75 MB of file — the server's core/media.js
 * IMAGE_MAX_BYTES, which the page cannot import.
 */
export const PICTURE_MAX_BYTES = 3_932_160;
/** The picture types a canvas writes as they are; another is drawn smaller as a PNG. */
const DRAWN_AS_IS = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * A picture drawn smaller until it is within `most`: at its own type where a canvas writes that, else as a PNG. Its
 * bytes go with its area, so each try scales its sides by the root of how far over the last one was. `draw(width,
 * height, type)` gives its bytes at that size (`drawnSmaller`), or null where it cannot. Null where it never fits.
 * @param {{ width: number, height: number, type: string, size: number }} pic
 * @param {(width: number, height: number, type: string) => Promise<Blob | null>} draw
 * @param {number} [most]
 * @returns {Promise<{ blob: Blob, type: string, width: number, height: number } | null>}
 */
export async function fitPicture(pic, draw, most = PICTURE_MAX_BYTES) {
  const type = DRAWN_AS_IS.has(pic.type) ? pic.type : "image/png";
  let scale = Math.min(1, Math.sqrt(most / Math.max(1, pic.size)) * 0.95);
  for (let tries = 0; tries < 8; tries++) {
    const width = Math.max(1, Math.round(pic.width * scale));
    const height = Math.max(1, Math.round(pic.height * scale));
    const blob = await draw(width, height, type);
    if (!blob) return null;
    if (blob.size <= most) return { blob, type: blob.type || type, width, height };
    scale *= Math.min(0.9, Math.sqrt(most / blob.size) * 0.95);
  }
  return null;
}

/**
 * A picture drawn smaller on the page's canvas (`fitPicture`); null where this browser cannot read it or draw it.
 * @param {Blob} file @param {number} most
 */
async function drawnSmaller(file, most) {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  /** @type {ImageBitmap} */
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    return await fitPicture(
      { width: bitmap.width, height: bitmap.height, type: file.type, size: file.size },
      (width, height, type) =>
        new Promise((resolve) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const pen = canvas.getContext("2d");
          if (!pen) return resolve(null);
          pen.drawImage(bitmap, 0, 0, width, height);
          canvas.toBlob((b) => resolve(b), type, 0.9);
        }),
      most,
    );
  } finally {
    bitmap.close();
  }
}
/** The menu's file kinds; a box that takes PDFs offers them too. */
const ACCEPT = "image/*,.txt,.md,.log,.json,.js,.ts,.py,.rs,.go,.java,.c,.cpp,.h,.cs,.sh,.yml,.yaml,.toml,.xml,.html,.css";

/** What a box that hands agents pictures alone says of a PDF. @param {string} name */
export const pdfRefused = (name) => `${name} is a PDF: it goes with a message to the chat — here an agent takes pictures and text files`;
/** A PDF by its type or its name, before its bytes are read. @param {File} f */
const namedPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
/** A file's bytes as base64. @param {Blob} f @returns {Promise<string>} */
const base64Of = (f) =>
  new Promise((res) => {
    const rd = new FileReader();
    rd.onload = () => res(String(rd.result).split(",")[1] || "");
    rd.readAsDataURL(f);
  });

/**
 * An attachment as a block of the message: a picture; a PDF as a document (the server gives it to the model as it is,
 * or its text); a team's result as the words your agent gets (§10 O3); any other file fenced under its name.
 * @param {any} a
 */
export const attachmentBlock = (a) =>
  a.kind === "image" ? { type: "image", source: { type: "base64", media_type: a.type, data: a.data } }
    : a.kind === "pdf" ? { type: "document", title: String(a.name || "document.pdf"), source: { type: "base64", media_type: "application/pdf", data: a.data } }
      : a.kind === "team" ? { type: "text", text: String(a.text || "") }
        : { type: "text", text: `\n\nFile: ${a.name}\n\`\`\`\n${a.text}\n\`\`\`` };

/** A file's size in words: 812 bytes, 14 KB, 2.4 MB. @param {number} n */
const sizeWords = (n) => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`);
/** What a message carries of an attachment: a picture's or a PDF's base64, a file's or a result's text. @param {any} a */
const carried = (a) => (a.kind === "image" || a.kind === "pdf" ? String(a.data || "").length : String(a.text || "").length);
/** What Filament takes in one request, in words. @param {number} most */
const doorWords = (most) => `the ${sizeWords(most)} Filament takes in one request (server.maxBodyBytes)`;

/**
 * @param {{ onChange?: () => void, onReject?: (msg: string) => void }} [cb]
 * @param {{ pdfs?: boolean, most?: () => number, shrink?: (file: Blob, most: number) => Promise<{ blob: Blob, type: string } | null> }} [o]
 *   `pdfs`: the box takes PDFs (the chat's own box); off, it refuses them in words. `most`: what Filament takes in one
 *   request (`server.maxBodyBytes`, as the page has it; 0 while it does not). `shrink`: draws a picture smaller
 *   (`drawnSmaller`, on the page's canvas)
 * @returns {{ el: HTMLElement, overlay: HTMLElement, input: HTMLInputElement, list: () => any[], add: (files: FileList | File[]) => Promise<void>, put: (item: any) => void, clear: () => void, restore: (files: any[]) => void, handOver: (files: any[]) => void, over: () => string | null }}
 */
export function createAttachments(cb = {}, { pdfs = true, most = () => 0, shrink = drawnSmaller } = {}) {
  /** @type {any[]} */
  let items = [];
  /** The box's files as one chat has them, counted: `handOver` gives the box to another chat's list. */
  let held = 0;
  /** What the box's attachments come to in a message, with `item` beside them. @param {any} [item] */
  const carrying = (item) => items.reduce((n, a) => n + carried(a), item ? carried(item) : 0);
  /** Whether `item` would take the message past what Filament takes in one request: said in words if it would. @param {any} item */
  const tooMuch = (item) => {
    const door = Number(most()) || 0;
    const n = carrying(item);
    if (!(door > 0) || n <= door) return false;
    cb.onReject?.(`${item.name} would take this message to ${sizeWords(n)}, past ${doorWords(door)}`);
    return true;
  };
  const el = h("div", { class: "atts hidden" });
  const overlay = h("div", { class: "drop-overlay hidden" }, "Drop to add attachments");
  const input = h("input", { type: "file", class: "hidden", multiple: "", accept: pdfs ? `${ACCEPT},.pdf,application/pdf` : ACCEPT });

  // Each attachment is a card (HarnessV3 §15 item 92): an image shows itself, a text file its kind on a tile; the name,
  // the kind and the size beside it; the remove button a small disc on the corner.
  const draw = () => {
    el.classList.toggle("hidden", !items.length);
    el.replaceChildren(...items.map((a, i) => {
      // A team's result (team_v2_plan §10 O3, Send to your agent…): its team and its findings in a word, its size; the
      // words your agent gets go ahead of yours when Send sends the box.
      if (a.kind === "team")
        return h("span", { class: "att is-team", title: `${a.name}: whole, as its lead wrote it — it goes ahead of your words` },
          h("span", { class: "att-file is-team", html: ICONS.users }),
          h("span", { class: "att-text" }, h("span", { class: "att-name" }, a.line ? `${a.name} · ${a.line}` : a.name), h("span", { class: "att-size" }, `${tokenWords(a.text)} · whole, as its lead wrote it`)),
          h("button", { class: "x", type: "button", title: `Remove ${a.name}`, "aria-label": `Remove ${a.name}`, html: ICONS.x, onclick: () => { items.splice(i, 1); draw(); cb.onChange?.(); } }));
      // A picture drawn smaller says so, and from what; drawn as another type, it names the type it is now.
      const smaller = a.kind === "image" && a.smaller ? a.smaller : null;
      const ext = a.kind === "pdf" ? "PDF" : smaller && smaller.type !== a.type ? String(a.type).split("/").pop()?.toUpperCase() || "" : String(a.name).includes(".") ? (String(a.name).split(".").pop() || "").slice(0, 4).toUpperCase() : "";
      const title = `${a.name} · ${sizeWords(a.size)}${smaller ? ` · made smaller from ${sizeWords(smaller.from)}, to fit the ${PICTURE_MAX_BYTES / 1048576} MB a picture may be` : ""}`;
      return h("span", { class: `att${a.kind === "image" ? " is-image" : ""}`, title },
        a.kind === "image"
          ? h("img", { class: "att-thumb", src: `data:${a.type};base64,${a.data}`, alt: "" })
          : h("span", { class: "att-file", html: ICONS.fileText }),
        h("span", { class: "att-text" }, h("span", { class: "att-name" }, a.name), h("span", { class: "att-size" }, [ext, sizeWords(a.size), smaller ? "made smaller" : ""].filter(Boolean).join(" · "))),
        h("button", { class: "x", type: "button", title: `Remove ${a.name}`, "aria-label": `Remove ${a.name}`, html: ICONS.x, onclick: () => { items.splice(i, 1); draw(); cb.onChange?.(); } }));
    }));
  };

  /**
   * Files added to the box: each read, then kept — unless the box went to another chat while it was read (`held`),
   * whose list it never joins, or it would take the message past what Filament takes in one request (`tooMuch`). A
   * picture past PICTURE_MAX_BYTES is drawn smaller first (`shrink`), and one that cannot be is refused in words.
   * @param {FileList | File[]} files
   */
  async function add(files) {
    const mine = held;
    for (const f of Array.from(files)) {
      if (items.length >= MAX_FILES) { cb.onReject?.("You can attach up to 10 attachments"); break; }
      if (f.size > MAX_BYTES) { cb.onReject?.(`${f.name} is over 20 MB`); continue; }
      if (f.type.startsWith("image/")) {
        const fit = f.size > PICTURE_MAX_BYTES ? await shrink(f, PICTURE_MAX_BYTES) : null;
        if (mine !== held) return;
        if (f.size > PICTURE_MAX_BYTES && !fit) {
          cb.onReject?.(`${f.name} is a picture of ${sizeWords(f.size)}, past the ${PICTURE_MAX_BYTES / 1048576} MB a picture may be, and this browser could not draw it smaller`);
          continue;
        }
        const data = await base64Of(fit ? fit.blob : f);
        if (mine !== held) return;
        const type = f.type || "image/png";
        const item = { kind: "image", name: f.name, size: fit ? fit.blob.size : f.size, type: fit ? fit.type : type, data, ...(fit ? { smaller: { from: f.size, type } } : {}) };
        if (!tooMuch(item)) items.push(item);
      } else {
        const named = namedPdf(f);
        const text = named ? "" : await f.text();
        if (mine !== held) return;
        // One whose type and name do not say so is a PDF by its first bytes, as `read` tells one.
        if (named || text.startsWith("%PDF-")) {
          if (!pdfs) { cb.onReject?.(pdfRefused(f.name)); continue; }
          const data = await base64Of(f);
          if (mine !== held) return;
          const item = { kind: "pdf", name: f.name, size: f.size, type: "application/pdf", data };
          if (!tooMuch(item)) items.push(item);
          continue;
        }
        const item = { kind: "text", name: f.name, size: f.size, text: text.slice(0, 200_000) };
        if (!tooMuch(item)) items.push(item);
      }
    }
    draw();
    cb.onChange?.();
  }

  input.onchange = async () => { await add(input.files || []); input.value = ""; };

  return {
    el, overlay, input,
    list: () => items.slice(),
    add,
    /** An attachment made by the page (a team's result): one per team, the newest in its place. @param {any} item */
    put(item) {
      const at = items.findIndex((a) => a.kind === item.kind && a.team?.id && a.team.id === item.team?.id);
      if (at >= 0) items[at] = item;
      else if (items.length >= MAX_FILES) return void cb.onReject?.("You can attach up to 10 attachments");
      else items.push(item);
      draw();
      cb.onChange?.();
    },
    clear: () => { items = []; draw(); },
    /** Put a rejected send's files back. @param {any[]} files */
    restore: (files) => { items = files.slice(); draw(); },
    /** The box handed to another chat's files: a file still being read for the chat before joins neither. @param {any[]} files */
    handOver: (files) => { held++; items = files.slice(); draw(); },
    /** The words that refuse the box's message where its attachments together pass what Filament takes in one request; else null. */
    over() {
      const door = Number(most()) || 0;
      const n = carrying();
      return door > 0 && n > door ? `This message's attachments come to ${sizeWords(n)}, past ${doorWords(door)}: take some out and send again` : null;
    },
  };
}
