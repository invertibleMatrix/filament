// @ts-check
// A visual the agent drew, as its card in the answer (HarnessV4_Visuals_Plan §5, E16 step 2): a header that names it a
// visual — so a picture is never taken for part of the harness (VC-28) — with Save, Code and Copy (VS-D10), Save also
// keeping it as an artifact (HarnessV4_Artifacts_Plan AFC-101); under it
// the picture in its closed frame (VS-D3), "Drawing title…" while the agent writes it (VS-D11), and one line for what
// failed in it, with Tell the agent (VS-D8). The frame never moves in the page once drawn: a frame moved draws again
// from its start (the timeline keeps it in place, VC-41).
import { h, setHtml } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { confirmDialog, menu, toast } from "../lib/ui.js";
import { chipActions } from "./tools/layout.js";
import { mdChat } from "../lib/md-stream.js";
import { paintFences } from "../lib/highlighter.js";
import { isSvg } from "../../lib/visual-look.js";
import { whenShown } from "../lib/when-shown.js";
import { askText, clickedIn } from "../lib/frame-ask.js";
import { frameDoc, frameHeight, failureOf, failureLine, linkOf, lookFrom, htmlFile, svgFile, writingWords, fileNameOf, codeFence, HEIGHT_MAX } from "../lib/visuals.js";

/** @typedef {import("../lib/visuals.js").Look} Look */
/** @typedef {import("../lib/visuals.js").Failure} Failure */
/** @typedef {{ title: string, code: string, loading: string[] }} Kept */
/**
 * @typedef {object} VisualHears  what the page does for a visual
 * @property {(text: string) => void} onAsk  a click in the visual asked for these words: they go into the message box, never sent
 * @property {(text: string) => void} onTell  Tell the agent: the failure's words, into the message box
 */

/** A visual's code by where it is kept, read once a page (VS-D9: the whole code, from the archive): the latest read
 *  kept, as the image cards keep their pictures (tools/render.js), so a page open all day does not hold every one. @type {Map<string, Promise<Kept>>} */
const codes = new Map();
/** How many visuals' codes are kept, the one read longest ago let go first. */
const CODES_KEPT = 24;
/**
 * Where a visual is kept: on turn `n` of session `chain`, or on the session itself (`n` null) — a helper's that no turn
 * launched (VS-D48). @typedef {{ chain: string, n: number | null }} Place
 */
/** @param {Place} at @param {string} id @returns {Promise<Kept>} */
function readCode(at, id) {
  const where = at.n == null ? "" : `/turns/${at.n}`;
  const key = `${at.chain}${where}/${id}`;
  const had = codes.get(key);
  if (had) {
    // Read again: the newest kept.
    codes.delete(key);
    codes.set(key, had);
    return had;
  }
  const read = api(`/sessions/${encodeURIComponent(at.chain)}${where}/visuals/${encodeURIComponent(id)}`).then((v) => ({ title: String(v?.title || ""), code: String(v?.code ?? ""), loading: Array.isArray(v?.loading) ? v.loading : [] }));
  // A failed read is not kept: Try again reads it again — its own entry, not one a later read put in its place.
  read.catch(() => { if (codes.get(key) === read) codes.delete(key); });
  codes.set(key, read);
  if (codes.size > CODES_KEPT) codes.delete(codes.keys().next().value ?? "");
  return read;
}

/** One pixel to read a color through, the way a chart's script will. @type {CanvasRenderingContext2D | null} */
let pixel = null;
/**
 * A theme value as a plain color (`rgb()`/`rgba()`) and its parts: the page's tokens mix colors (`color-mix`), which a
 * visual's script hands to a canvas as they are. Null where it is no color.
 * @param {string} value
 */
function colorOf(value) {
  if (!value) return null;
  pixel ||= /** @type {HTMLCanvasElement} */ (h("canvas", { width: 1, height: 1 })).getContext("2d", { willReadFrequently: true });
  if (!pixel) return null;
  const sentinel = "#010203";
  pixel.fillStyle = sentinel;
  pixel.fillStyle = value;
  if (pixel.fillStyle === sentinel && value.toLowerCase() !== sentinel) return null;
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data;
  const alpha = +(a / 255).toFixed(3);
  return { css: alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`, rgb: /** @type {[number, number, number]} */ ([r, g, b]), alpha };
}

/** The look of the moment, read once for each theme and Motion setting. @type {{ key: string, look: Look } | null} */
let looked = null;
/** The page's look as a visual is drawn in it (VS-D5). @returns {Look} */
export function pageLook() {
  const root = document.documentElement;
  const key = `${root.className}|${root.dataset.motion || ""}`;
  if (looked?.key === key) return looked.look;
  const css = getComputedStyle(root);
  const look = lookFrom((t) => css.getPropertyValue(t), { light: root.classList.contains("theme-zai-light"), motion: root.dataset.motion, color: colorOf });
  looked = { key, look };
  return look;
}

/** The visuals' frames on the page now. @returns {HTMLIFrameElement[]} */
const framesNow = () => Array.from(document.querySelectorAll("iframe.visual-frame"));
/** Each frame's card, by its frame: how a message is heard from the frame that sent it. @type {WeakMap<HTMLIFrameElement, (m: any) => void>} */
const hearers = new WeakMap();
/** Each frame's redraw, by its frame, for a theme or Motion switch (VC-51). @type {WeakMap<HTMLIFrameElement, () => void>} */
const redraws = new WeakMap();
let wired = false;
/**
 * The page's ears, once: a message counts only from a visual's own frame (VC-44), found among the frames on the page by
 * the window that sent it; a switch of theme or Motion draws every visual again in the new look (VC-29, VC-51).
 */
function wire() {
  if (wired) return;
  wired = true;
  window.addEventListener("message", (e) => {
    if (e.data?.filament !== "visual" || !e.source) return;
    const from = framesNow().find((f) => f.contentWindow === e.source);
    if (from) hearers.get(from)?.(e.data);
  });
  let key = "";
  new MutationObserver(() => {
    const root = document.documentElement;
    const now = `${root.className}|${root.dataset.motion || ""}`;
    if (now === key) return;
    key = now;
    for (const f of framesNow()) redraws.get(f)?.();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-motion"] });
  key = `${document.documentElement.className}|${document.documentElement.dataset.motion || ""}`;
}

/** The line under a picture drawn in Claude desktop (VS-D15, VS-D56). */
export const DESKTOP_LINE = "Made in Claude desktop, drawn here in Filament's colors: it may look a little different than it did there.";

/**
 * A visual's card. It starts as what the agent is writing (`writing`) or as the visual kept (`show`), and turns from
 * the first into the second in place.
 * @param {{ id: string, title?: string, madeIn?: string | null }} at  the call's id, its title once known, and the app
 *   it was drawn in where that is not Filament (a chat imported from Claude Code)
 * @param {VisualHears} hears
 */
export function visualCard(at, hears) {
  wire();
  const made = { madeIn: at.madeIn || null };
  let title = String(at.title || "");
  /** @type {Kept | null} */
  let kept = null;
  /** @type {Failure[]} */
  let failures = [];
  /** @type {string} */
  let said = "";
  let tall = false;
  let showingCode = false;
  /** @type {Place | null} */
  let where = null;

  const titleEl = h("span", { class: "visual-title" }, title);
  const save = h("button", { class: "visual-act", type: "button", title: chipActions.openArtifact ? "Save it as a file, or keep it as an artifact" : "Save it as a file", disabled: "" }, "Save", h("span", { class: "visual-caret", html: ICONS.chevronDown }));
  const code = h("button", { class: "visual-act", type: "button", title: "Show its code in place of the picture", "aria-pressed": "false", disabled: "" }, "Code");
  const copy = h("button", { class: "visual-act visual-copy", type: "button", title: "Copy its code", "aria-label": "Copy its code", disabled: "", html: ICONS.copy });
  const head = h("div", { class: "visual-head" },
    h("span", { class: "visual-ic", html: ICONS.palette }),
    h("span", { class: "visual-kind" }, "Visual"),
    titleEl,
    h("span", { class: "visual-acts" }, save, code, copy));
  const body = h("div", { class: "visual-body" });
  const codeBox = h("div", { class: "visual-code a-md hidden" });
  const note = h("div", { class: "visual-note hidden", role: "status" });
  const origin = made.madeIn === "claude-desktop" ? h("div", { class: "visual-origin" }, DESKTOP_LINE) : null;
  const el = h("div", { class: "visual-card", "data-visual": at.id }, head, body, codeBox, note, origin);
  /** @type {HTMLIFrameElement | null} */
  let frame = null;

  const setTitle = (/** @type {string} */ t) => {
    if (!t || t === title) return;
    title = t;
    titleEl.textContent = t;
  };
  /** The line under the picture: what failed, with Tell the agent; else a link refused; else that it scrolls inside. */
  const paintNote = () => {
    const failed = failureLine(title, failures);
    /** @type {(string | HTMLElement)[]} */
    const parts = [];
    if (failed) {
      parts.push(h("span", { class: "visual-note-ic", html: ICONS.shieldAlert }), h("span", { class: "visual-note-text", title: failed.more.join("\n") }, failed.line));
      parts.push(h("button", { class: "visual-tell", type: "button", title: "Write this into your message box; nothing is sent until you send it", onclick: () => hears.onTell(failed.tell) }, "Tell the agent"));
    } else if (said) parts.push(h("span", { class: "visual-note-text" }, said));
    else if (tall) parts.push(h("span", { class: "visual-note-text" }, `Drawn ${HEIGHT_MAX.toLocaleString("en-US")} px tall; the rest scrolls inside it.`));
    note.replaceChildren(...parts);
    note.classList.toggle("hidden", !parts.length);
  };

  /** A message from this card's frame: its height, an ask or a link after a click in it, a failure. @param {any} m */
  const hear = (m) => {
    if (!frame) return;
    if (m.kind === "height") {
      const want = frameHeight(m.h);
      frame.style.height = `${want}px`;
      const over = Number(m.h) > HEIGHT_MAX;
      if (over !== tall) {
        tall = over;
        paintNote();
      }
      return;
    }
    if (m.kind === "fail") {
      const f = failureOf(m);
      if (f && failures.length < 50) {
        failures = [...failures, f];
        paintNote();
      }
      return;
    }
    if (!clickedIn(frame)) return;
    if (m.kind === "ask") {
      const text = askText(m.text);
      if (text) hears.onAsk(text);
      return;
    }
    if (m.kind === "link") {
      const href = linkOf(m.href);
      if (!href) {
        said = `It asked to open “${String(m.href ?? "").slice(0, 120)}”; a visual opens only http and https links.`;
        paintNote();
        return;
      }
      void confirmDialog({ title: "Open this link?", description: `The visual ${title} asks to open:\n${href}`, confirmLabel: "Open" }).then((yes) => {
        if (yes) window.open(href, "_blank", "noopener,noreferrer");
      });
    }
  };

  /** The picture drawn in the look of the moment: a new frame document, so a chart's canvas takes the new colors. */
  const draw = () => {
    if (!kept) return;
    failures = [];
    said = "";
    tall = false;
    paintNote();
    if (!frame) {
      const made = /** @type {HTMLIFrameElement} */ (h("iframe", { class: "visual-frame", sandbox: "allow-scripts", referrerpolicy: "no-referrer", title: `Visual: ${title}`, loading: "eager" }));
      hearers.set(made, hear);
      redraws.set(made, draw);
      body.replaceChildren(made);
      frame = made;
    }
    frame.srcdoc = frameDoc(kept.code, pageLook(), made);
  };

  /** Its code could not be read (VC-47): why, with Try again where there is somewhere to read it from. @param {string} why */
  const unread = (why) => {
    body.replaceChildren(h("div", { class: "visual-unread" },
      h("span", {}, `This visual could not be read: ${why}.`),
      where ? h("button", { class: "visual-tell", type: "button", onclick: () => void load() }, "Try again") : null));
  };
  const load = async () => {
    if (!where) return;
    if (!frame) body.replaceChildren(h("div", { class: "visual-writing" }, h("span", { class: "work-state gradient" }, `Opening ${title || "the visual"}…`)));
    try {
      kept = await readCode(where, at.id);
    } catch (/** @type {any} */ e) {
      return unread(String(e?.message || e).replace(/\.$/, ""));
    }
    setTitle(kept.title);
    for (const b of [save, code, copy]) b.removeAttribute("disabled");
    draw();
  };

  /**
   * The artifact kept from this visual (AFC-102), by its name and title: null where none is, where the page cannot
   * open one, or where it could not be asked — Keep then answers with the one kept, if one is.
   */
  const keptAs = async () => {
    if (!where || !chipActions.openArtifact) return null;
    try {
      const a = (await api(`/artifacts?chain=${encodeURIComponent(where.chain)}&visual=${encodeURIComponent(at.id)}`))?.artifacts?.[0];
      return a ? { name: String(a.name), title: String(a.title) } : null;
    } catch {
      return null;
    }
  };
  /** Keep it as an artifact (AFC-101): a page of its own, opened beside the chat. @param {Place} w */
  const keep = async (w) => {
    try {
      const a = await api("/artifacts", { method: "POST", body: { visual: { chain: w.chain, turn: w.n, id: at.id } } });
      chipActions.openArtifact?.(String(a.name));
      toast(a.already ? `${a.title} was kept already: it is open beside the chat.` : `Kept as the artifact ${a.title}, open beside the chat.`);
    } catch (/** @type {any} */ e) {
      toast(`Not kept: ${String(e?.message || e).replace(/^Not kept: /, "")}`, "err");
    }
  };

  save.onclick = async () => {
    if (!kept) return;
    const k = kept;
    const w = where;
    const svg = isSvg(k.code);
    const down = (/** @type {string} */ text, /** @type {string} */ type, /** @type {"html" | "svg"} */ ext) => {
      const url = URL.createObjectURL(new Blob([text], { type }));
      h("a", { href: url, download: fileNameOf(title, ext) }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    };
    const as = await keptAs();
    const open = chipActions.openArtifact;
    menu([
      { label: "HTML file", desc: "Opens alone in a browser, in these colors", onClick: () => down(htmlFile(k.code, pageLook(), title, made), "text/html", "html") },
      ...(svg ? [{ label: "SVG file", desc: "The drawing, its colors written in", onClick: () => { const s = svgFile(k.code, pageLook(), made); if (s) down(s, "image/svg+xml", "svg"); } }] : []),
      ...(w && open
        ? [as
          ? { label: `Open ${as.title}`, desc: "The artifact kept from it, beside the chat", onClick: () => open(as.name) }
          : { label: "Keep as artifact", desc: "A page of its own beside the chat, which agents can change", onClick: () => void keep(w) }]
        : []),
    ], { anchor: save, align: "end" });
  };
  code.onclick = () => {
    if (!kept) return;
    showingCode = !showingCode;
    code.setAttribute("aria-pressed", String(showingCode));
    code.classList.toggle("on", showingCode);
    if (showingCode && !codeBox.childElementCount) {
      setHtml(codeBox, mdChat(codeFence(kept.code), null).out);
      paintFences(codeBox).catch(() => {});
    }
    // The frame is hidden, never taken out: taken out it would draw again from its start.
    body.classList.toggle("hidden", showingCode);
    codeBox.classList.toggle("hidden", !showingCode);
  };
  copy.onclick = () => {
    if (!kept || !navigator.clipboard) return;
    navigator.clipboard.writeText(kept.code).then(() => {
      copy.classList.add("copied");
      setTimeout(() => copy.classList.remove("copied"), 2000);
    }).catch(() => {});
  };

  return {
    el,
    /**
     * While the agent writes it (VS-D11): "Drawing title…", its lines, how much is written.
     * @param {{ title?: string, loading?: string[], chars?: number }} w
     */
    writing(w) {
      if (kept || where) return;
      setTitle(String(w.title || ""));
      const words = writingWords(w);
      body.replaceChildren(h("div", { class: "visual-writing" },
        h("span", { class: "work-state gradient" }, words.head),
        ...words.lines.map((l) => h("div", { class: "visual-writing-line" }, l)),
        words.size ? h("div", { class: "visual-writing-size" }, words.size) : null));
    },
    /**
     * The visual kept on turn `n` of session `chain`, or on the session (`session`): its code read and drawn once the
     * card is on screen. A page that does not know the turn yet says so; it is shown again once it does.
     * @param {{ chain: string | null, n: number | null, session?: boolean, title?: string }} w
     */
    show(w) {
      setTitle(String(w.title || ""));
      const n = w.session ? null : w.n;
      if (!w.chain || (!w.session && !n)) {
        if (!where) unread("the page does not know its turn yet");
        return;
      }
      if (where && where.chain === w.chain && where.n === n) return;
      where = { chain: w.chain, n };
      if (!frame) body.replaceChildren(h("div", { class: "visual-writing" }, h("span", { class: "work-state gradient" }, `Opening ${title || "the visual"}…`)));
      whenShown(el, () => void load());
    },
  };
}
