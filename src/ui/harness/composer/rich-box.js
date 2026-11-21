// @ts-check
// The message box (the owner's word of 11-02): what a message is typed in, read and written as a textarea is — its words
// as text (`value`), the caret as offsets into them (`selectionStart`, `selectionEnd`, `setSelectionRange`), its own
// events — with each chat tagged in it (`chatTag`'s `[title](chat:<id>)`) drawn as the chat's link (lib/chat-link.js),
// which a press opens (lib/chat-open.js), and each project file tagged with `@` and typed out whole (`FILE_MENTION`, a
// space after it), outside code, as the file's chip: each one piece the caret steps over and Backspace takes whole. The words are the
// box's text alone: what is sent, kept as a draft, copied and read by the panels is each tag as written, never markup.
//
// It is an element you type in (`contenteditable`, its words `white-space: pre-wrap`). What the browser writes as you
// type stays as it wrote it while it shows as the text; where its writing no longer stands for the text as the box draws
// it — a line as a block of its own, a tag's words typed, markup dropped in — the box draws it again from the text, the
// caret kept where it was in the text. A new line and a paste go in through the browser's own inserts — plain text, or
// words with lines or tags as the box draws them — so its undo keeps them.
import { h } from "../../lib/dom.js";
import { esc } from "../../lib/md.js";
import { CHAT_LINK, FILE_MENTION, fileOfTag, inCode } from "../lib/labels.js";
import { chatLinkEl } from "../lib/chat-open.js";
import { ICONS } from "../lib/icons.js";

/**
 * @typedef {HTMLElement & { value: string, selectionStart: number, selectionEnd: number, placeholder: string,
 *   setSelectionRange: (start: number, end: number) => void }} RichBox
 */

/** The tags a text holds, each the box's piece: a chat's (its title and id its groups), or a file's (none). */
const TAGS = new RegExp(`${CHAT_LINK.source}|${FILE_MENTION.source}`, "g");
/** One tag, anywhere in a text (`TAGS` keeps its place in a text across calls). */
const ONE_TAG = new RegExp(TAGS.source);
/**
 * The tags of a text the box draws as its pieces, in order: every chat's, and each file's outside code — a decorator
 * (`@pytest.fixture`) in pasted code stays its words. @param {string} t
 */
const tagsIn = (t) => {
  const code = inCode(t);
  return [...t.matchAll(TAGS)].filter((m) => m[2] || !code(m.index ?? 0));
};
/** What the browser writes as a block of its own, a line of the text. */
const BLOCK = /^(DIV|P|LI|PRE|BLOCKQUOTE|H[1-6])$/;

/**
 * What nodes of the box say as text, as the box shows them: a chat's link its tag, a line break a new line, a block a
 * line of its own, the rest their words. The last line break of the box or of a block shows no line of its own — the
 * box's last `<br>`, the one the browser writes after a new line at the end, its `<br>` in an empty line — save in a
 * part cut short (`whole` false: what lies before a point of the box, whose last line break is the caret's).
 * @param {ArrayLike<Node>} nodes @param {boolean} [whole] @returns {string}
 */
export function textOfNodes(nodes, whole = true) {
  const list = Array.from(nodes);
  let out = "";
  /** Whether a block ended the line: what follows it starts the next. */
  let afterBlock = false;
  /** @param {string} s @param {boolean} [starts]  whether it starts a line where it stands (a line break does) */
  const add = (s, starts = !!s) => {
    if (afterBlock && starts && out && !out.endsWith("\n")) out += "\n";
    if (starts) afterBlock = false;
    out += s;
  };
  for (const [i, n] of list.entries()) {
    const last = whole && i === list.length - 1;
    if (n.nodeType === 3) {
      const words = String(/** @type {Text} */ (n).data).replace(/ /g, " ");
      add(last && words.endsWith("\n") ? words.slice(0, -1) : words, !!words);
    } else if (n.nodeType === 1) {
      const e = /** @type {Element} */ (n);
      const tag = e.getAttribute("data-tag");
      if (tag) add(tag);
      else if (e.tagName === "BR") add(last ? "" : "\n", true);
      else if (BLOCK.test(e.tagName)) {
        if (out && !out.endsWith("\n")) out += "\n";
        out += textOfNodes(e.childNodes);
        afterBlock = true;
      } else add(textOfNodes(e.childNodes, last));
    }
  }
  return out;
}

/**
 * The message box: an element with a textarea's ways (`RichBox`).
 * @param {{ placeholder?: string, label?: string }} [o]
 * @returns {RichBox}
 */
export function createRichBox({ placeholder = "", label = "Message" } = {}) {
  const doc = /** @type {Document} */ (globalThis.document);
  const el = /** @type {RichBox} */ (h("div", { class: "composer-input", contenteditable: "true", role: "textbox", "aria-multiline": "true", "aria-label": label, spellcheck: "true" }));
  let text = "";
  /** Where the caret stood in the text when last read: the page's selection where it is in the box. @type {[number, number]} */
  let sel = [0, 0];
  let composing = false;

  /**
   * A chat tagged in the text, as its link: one piece, written as its tag; no stop of the keyboard's, so Tab leaves the
   * box as it leaves a textarea. @param {string} tag @param {string} title @param {string} id
   */
  const linkOf = (tag, title, id) => chatLinkEl(title, id, { contenteditable: "false", draggable: "false", tabindex: "-1", "data-tag": tag });
  /** A project file or folder tagged in the text, as its chip: its path, unquoted, and lines, written as its tag. @param {string} tag */
  const fileOf = (tag) => {
    const { path, range } = fileOfTag(tag);
    return h("span", { class: "ref-chip is-file", contenteditable: "false", draggable: "false", "data-tag": tag, title: `${path}${range}` },
      h("span", { class: "ref-ic", html: path.endsWith("/") ? ICONS.folder : ICONS.file }), `${path}${range}`);
  };
  /** Words as the box draws them: as they are, each tag as its chat's link or its file's chip. @param {string} t @returns {Node[]} */
  const nodesOf = (t) => {
    /** @type {Node[]} */
    const nodes = [];
    let at = 0;
    for (const m of tagsIn(t)) {
      const i = m.index ?? 0;
      if (i > at) nodes.push(doc.createTextNode(t.slice(at, i)));
      nodes.push(m[2] ? linkOf(m[0], m[1].replace(/\\(.)/g, "$1"), m[2]) : fileOf(m[0]));
      at = i + m[0].length;
    }
    if (at < t.length) nodes.push(doc.createTextNode(t.slice(at)));
    return nodes;
  };
  /** The box's last line break: after a new line that ends the text, it holds the line that new line opens. */
  const lastBreak = () => h("br");
  /**
   * Whether the text is empty, marked on the box: its words for what to type show by the mark, never by the box having
   * no node — the browser leaves a line break of its own in a box it empties.
   */
  const markEmpty = () => el.classList.toggle("is-empty", !text);
  /** The box drawn from its text, a last line break kept open. */
  const draw = () => {
    el.replaceChildren(...nodesOf(text), ...(text.endsWith("\n") ? [lastBreak()] : []));
    markEmpty();
  };
  /**
   * Whether the box stands for `t` as it shows: words, the pieces of its tags and a last line break alone — the box's,
   * or the one the browser leaves there, which shows no line of its own (in a box it emptied too) —, its tags each its
   * piece, in their order: none typed out among the words, and no piece whose words no longer make a tag where they
   * stand (a file's whose space after it went). Where the text ends with a new line, the line it opens shows: the last
   * line break follows it, or the browser's own new line after it (what it writes for a line break at the end).
   * @param {string} t
   */
  const drawnFor = (t) => {
    const kids = Array.from(el.childNodes);
    if (!t) return !kids.length || (kids.length === 1 && /** @type {Element} */ (kids[0]).tagName === "BR");
    /** @type {string[]} */
    const pieces = [];
    for (const [i, n] of kids.entries()) {
      if (n.nodeType === 3) continue;
      const e = /** @type {Element} */ (n);
      const tag = e.getAttribute?.("data-tag");
      if (tag) {
        pieces.push(tag);
        continue;
      }
      if (e.tagName === "BR" && i === kids.length - 1) continue;
      return false;
    }
    const tags = tagsIn(t).map((m) => m[0]);
    if (tags.length !== pieces.length || tags.some((tag, i) => tag !== pieces[i])) return false;
    const end = /** @type {Node} */ (kids.at(-1));
    return !t.endsWith("\n") || end.nodeType !== 3 || /** @type {Text} */ (end).data.endsWith("\n");
  };

  const focused = () => doc.activeElement === el;
  /** The text's offset at a point of the box: what lies before it, read as text. @param {Node} node @param {number} offset */
  const offsetAt = (node, offset) => {
    const r = doc.createRange();
    r.setStart(el, 0);
    r.setEnd(node, offset);
    return textOfNodes(r.cloneContents().childNodes, false).length;
  };
  /**
   * The point of the box at an offset of the text, as `draw` draws it — never inside a chat's link: a point there is
   * after it; the box's last line break no character of the text. @param {number} at @returns {[Node, number]}
   */
  const pointAt = (at) => {
    let acc = 0;
    const kids = Array.from(el.childNodes);
    for (const [i, n] of kids.entries()) {
      if (n.nodeType === 3) {
        const len = /** @type {Text} */ (n).data.length;
        if (at <= acc + len) return [n, at - acc];
        acc += len;
        continue;
      }
      const e = /** @type {Element} */ (n);
      const tag = e.getAttribute("data-tag");
      const len = tag ? tag.length : e.tagName === "BR" && i < kids.length - 1 ? 1 : 0;
      if (at <= acc) return [el, i];
      if (at < acc + len) return [el, i + 1];
      acc += len;
    }
    return [el, kids.length];
  };
  /** Where the caret stands in the text: the page's selection where it is in the box, else where it was last. @returns {[number, number]} */
  const selNow = () => {
    const s = doc.getSelection?.();
    if (s && s.rangeCount && s.anchorNode && el.contains(s.anchorNode)) {
      const r = s.getRangeAt(0);
      sel = [offsetAt(r.startContainer, r.startOffset), offsetAt(r.endContainer, r.endOffset)];
    }
    return sel;
  };
  /** The page's selection set where the text's caret stands, while the box holds the focus. */
  const place = () => {
    const s = doc.getSelection?.();
    if (!s || !focused()) return;
    const r = doc.createRange();
    r.setStart(...pointAt(sel[0]));
    r.setEnd(...pointAt(sel[1]));
    s.removeAllRanges();
    s.addRange(r);
  };
  /** An offset as one of the text's: a whole number from its start to its end. @param {unknown} v */
  const inText = (v) => Math.max(0, Math.min(text.length, Math.floor(Number(v) || 0)));

  /** The text read back from what the browser wrote; the box drawn again where that no longer stands for it. */
  const readBack = () => {
    const [a, b] = selNow();
    text = textOfNodes(el.childNodes);
    markEmpty();
    if (composing || drawnFor(text)) return;
    draw();
    sel = [inText(a), inText(b)];
    place();
  };
  /**
   * Whether nothing of the text follows the page's selection in the box — its last line break at most, or a last new
   * line that shows none — and then the selection taken on to the box's end, so that words put there replace what lies
   * after them too. @returns {boolean}
   */
  const toEnd = () => {
    const s = doc.getSelection?.();
    if (!s || !s.rangeCount || !s.anchorNode || !el.contains(s.anchorNode)) return false;
    const r = s.getRangeAt(0);
    const rest = doc.createRange();
    rest.setStart(r.endContainer, r.endOffset);
    rest.setEnd(el, el.childNodes.length);
    if (textOfNodes(rest.cloneContents().childNodes)) return false;
    s.setBaseAndExtent(r.startContainer, r.startOffset, el, el.childNodes.length);
    return true;
  };
  /**
   * Words in at the caret, as typed, through the browser's own inserts, which its undo keeps: words of one line its
   * plain text, words with lines or tags as the box draws them (its plain text's `\n` would be a block of its own, its
   * line break a second new line at the end of the box or before a link, and a tag's words drawn again). Words that end
   * the text with a new line take the box's end with them and bring its last line break, for their last line to show:
   * the browser drops the one it finds there. Where what it wrote does not read as the words, the box is drawn.
   * @param {string} words
   */
  const put = (words) => {
    const [a, b] = selNow();
    const want = text.slice(0, a) + words + text.slice(b);
    const drawn = () =>
      [...nodesOf(words), ...(words.endsWith("\n") && toEnd() ? [lastBreak()] : [])].map((n) => (n.nodeType === 3 ? esc(n.textContent) : /** @type {Element} */ (n).outerHTML)).join("");
    const wrote = words.includes("\n") || ONE_TAG.test(words) ? doc.execCommand?.("insertHTML", false, drawn()) : doc.execCommand?.("insertText", false, words);
    if (wrote && text === want) return;
    text = want;
    sel = [a + words.length, a + words.length];
    draw();
    place();
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  el.addEventListener("compositionstart", () => { composing = true; });
  el.addEventListener("compositionend", () => {
    composing = false;
    readBack();
  });
  el.addEventListener("beforeinput", (/** @type {any} */ e) => {
    if (e.isComposing) return;
    const kind = String(e.inputType || "");
    if (kind === "insertParagraph" || kind === "insertLineBreak") {
      e.preventDefault();
      put("\n");
    } else if (kind === "insertFromPaste" || kind === "insertFromYank") {
      // Its plain text alone, its line ends as a textarea takes them; with none, nothing changes.
      e.preventDefault();
      const words = String(e.dataTransfer?.getData("text/plain") ?? e.data ?? "").replace(/\r\n?/g, "\n");
      if (words) put(words);
    } else if (kind.startsWith("format")) e.preventDefault();
  });
  el.addEventListener("input", () => readBack());
  // A press on a chat's link opens it (chat-open.js) and leaves the focus where it was: the link never holds it.
  el.addEventListener("mousedown", (/** @type {any} */ e) => {
    if (e.target?.closest?.("[data-tag]")) e.preventDefault();
  });
  // Copied or cut, the words are the text's: a chat's link goes as its tag, and pasted back it is the link again.
  for (const kind of ["copy", "cut"])
    el.addEventListener(kind, (/** @type {any} */ e) => {
      const [a, b] = selNow();
      if (a === b || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", text.slice(a, b));
      if (kind === "cut" && !doc.execCommand?.("delete")) put("");
    });
  doc.addEventListener?.("selectionchange", () => {
    if (focused()) selNow();
  });

  const focusEl = el.focus.bind(el);
  Object.defineProperties(el, {
    value: {
      get: () => text,
      set: (v) => {
        text = String(v ?? "");
        sel = [text.length, text.length];
        draw();
        place();
      },
      configurable: true,
    },
    selectionStart: {
      get: () => selNow()[0],
      set: (v) => {
        const a = inText(v);
        sel = [a, Math.max(a, selNow()[1])];
        place();
      },
      configurable: true,
    },
    selectionEnd: {
      get: () => selNow()[1],
      set: (v) => {
        const b = inText(v);
        sel = [Math.min(selNow()[0], b), b];
        place();
      },
      configurable: true,
    },
    placeholder: {
      get: () => el.getAttribute("data-placeholder") || "",
      set: (v) => {
        el.setAttribute("data-placeholder", String(v ?? ""));
        el.setAttribute("aria-placeholder", String(v ?? ""));
      },
      configurable: true,
    },
    setSelectionRange: {
      value: (/** @type {number} */ start, /** @type {number} */ end) => {
        const a = inText(start);
        sel = [a, Math.max(a, inText(end))];
        place();
      },
      configurable: true,
    },
    // Focused, the caret stands where the text's did — a focus alone would set it at the box's start.
    focus: {
      value: (/** @type {FocusOptions} */ o) => {
        focusEl(o);
        place();
      },
      configurable: true,
    },
  });
  el.placeholder = placeholder;
  markEmpty();
  return el;
}
