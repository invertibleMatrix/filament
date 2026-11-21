// @ts-check
// Selection → Add to chat: a floating button over a selection inside the transcript, which hands the selected words to
// the composer as a quote. It stands where the selection is, and as long as it is: a click elsewhere, a key, another
// chat drawn takes the selection and the button with it, and it follows the selection as the transcript scrolls, gone
// once the selection is out of view. It went only on the next mouse-up inside the transcript, and stayed on the page
// where the selection had been (the owner's of 10-28).
import { h } from "../../lib/dom.js";

/**
 * The button, for the host to hold; it stands in the host's frame.
 * @param {{ host: HTMLElement, scroller: HTMLElement, limit: number, onQuote: (text: string, kind: string) => void }} o
 * @returns {HTMLElement}
 */
export function quoteButton(o) {
  const btn = /** @type {HTMLElement} */ (h("button", { class: "quote-btn hidden", type: "button" }, "Add to chat"));
  const hide = () => {
    btn.classList.add("hidden");
  };
  /** Over the selection in the transcript, holding its words; none there, or out of view: gone. */
  const paint = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() || "";
    const n = sel?.anchorNode;
    if (!sel || !text || !n || !sel.rangeCount || !o.scroller.contains(n)) return hide();
    const range = sel.getRangeAt(0).getBoundingClientRect();
    const view = o.scroller.getBoundingClientRect();
    if (range.bottom < view.top || range.top > view.bottom) return hide();
    const hostBox = o.host.getBoundingClientRect();
    btn.style.left = `${Math.max(8, range.left - hostBox.left)}px`;
    btn.style.top = `${Math.max(8, range.top - hostBox.top - 36)}px`;
    btn.classList.remove("hidden");
    const row = (n.nodeType === 1 ? /** @type {Element} */ (n) : n.parentElement)?.closest(".u, .a, .a-final, .a-think");
    btn.dataset.kind = row?.classList.contains("u") ? "User message" : row?.classList.contains("a-think") ? "Reasoning" : "Assistant message";
    btn.dataset.text = text.slice(0, o.limit);
  };
  const shown = () => !btn.classList.contains("hidden");
  o.scroller.addEventListener("mouseup", paint);
  o.scroller.addEventListener("scroll", () => { if (shown()) paint(); }, { passive: true });
  document.addEventListener("selectionchange", () => { if (shown()) paint(); });
  // A press on it keeps the selection: one that cleared it would take the button before its click landed.
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => {
    const text = btn.dataset.text || "";
    if (text) o.onQuote(text, btn.dataset.kind || "Assistant message");
    hide();
    window.getSelection()?.removeAllRanges();
  });
  return btn;
}
