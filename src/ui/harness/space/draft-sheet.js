// @ts-check
// A draft, reviewed (HarnessV4_Space_Plan S5c, SG-D16, the mock's screen 13): Filament's sheet over the page. From — the
// connection and the account it sends as, a picker of those signed in at its address —, In (where it goes), the words
// it answers, quoted, your words to change in place, Made from (each link opens in your browser), the call Send makes,
// and Discard, Ask for a change…, Copy and Send. Send calls the connection's tool with your words exactly and nothing
// else, with no clock: "Sending… 3 s", with Stop. Sent: the sheet closes, a toast. Failed: the words in the sheet,
// which stays open, your words kept. Closed with changed words, they are kept in the draft (S5c-D7). Send is off,
// saying why, while the server is asked and where the tool cannot send — none, or one its server marks read-only. Ask
// for a change… opens the chat that wrote it with its box filled: nothing is sent there either. Only Send sends.
import { h } from "../../lib/dom.js";
import { button, dialog, toast } from "../lib/ui.js";
import { draftAsk, draftCall, linkParts } from "../lib/space-view.js";

/**
 * @typedef {import("../lib/space-view.js").NeedRow & { draft: import("../lib/space-view.js").Draft }} DraftRow
 * @typedef {{ row: DraftRow, from: { connection: string, account: string, accounts: string[] }, tool: { ok: boolean, words: string },
 *   chat: { name: string } | null, sending: boolean }} DraftLook  the sheet as its server reads it (`GET …/needs/:id/draft`)
 * @typedef {(method: string, path: string, body?: any) => Promise<{ ok: true, got: any } | { ok: false, error: string }>} Request
 *   a read or write of the draft's Space, by its path under `/space/:project`; its refusal in words
 */

/**
 * The sheet, open.
 * @param {{ row: DraftRow, request: Request, askChat?: (chain: string, words: string) => void }} o
 */
export function draftSheet({ row, request, askChat }) {
  const d = row.draft;
  const path = `/needs/${encodeURIComponent(row.id)}`;
  /** Your words as the sheet holds them, and as the draft keeps them. */
  let words = d.words;
  let kept = d.words;
  let account = d.account;
  /** @type {DraftLook | null} */
  let look = null;
  let sending = false;
  let done = false;
  let closed = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let ticking = null;

  const fromAccount = /** @type {HTMLSelectElement} */ (h("select", { class: "zc-input sds-account", "aria-label": "Sends as", hidden: "" }));
  const fromWords = h("span", { class: "sds-from-t" }, d.account ? `${d.connection} · ${d.account}` : d.connection);
  const field = (/** @type {string} */ label, /** @type {(Node | string)[]} */ ...value) => h("div", { class: "sds-row" }, h("span", { class: "sds-label" }, label), h("span", { class: "sds-value" }, ...value));
  const box = /** @type {HTMLTextAreaElement} */ (h("textarea", { class: "zc-input sds-words", rows: "7", spellcheck: "true", "aria-label": "Your words" }));
  box.value = words;
  const made = d.from.length
    ? field("Made from", h("ul", { class: "sds-from-list" },
        ...d.from.map((line) => h("li", {}, ...linkParts(line).map((part) => ("href" in part ? h("a", { href: part.href, target: "_blank", rel: "noopener noreferrer" }, part.href) : part.text))))))
    : null;
  const call = h("details", { class: "sds-call" },
    h("summary", {}, `Sends through ${d.connection} › ${d.tool}`),
    h("pre", { class: "sds-call-args" }, draftCall(d.args)));
  const toolLine = h("p", { class: "sds-tool", role: "status" }, `Asking ${d.connection} whether ${d.tool} sends…`);
  const said = h("p", { class: "sas-said sds-said", role: "alert" });
  said.hidden = true;

  const discard = button({ label: "Discard", variant: "ghost", class: "sds-discard", title: "Discard it: it moves to Done today, where Bring back puts it back" });
  const ask = button({ label: "Ask for a change…", variant: "ghost", class: "sds-ask" });
  const copy = button({ label: "Copy", variant: "outline", class: "sds-copy", title: "Copy your words: paste them where you like" });
  const stop = button({ label: "Stop", variant: "outline", class: "sds-stop", title: "Stops the call: its server is told to cancel" });
  stop.hidden = true;
  const send = button({ label: "Send", class: "sds-send" });
  const foot = h("div", { class: "zc-dialog-foot sds-foot" },
    discard, ask, copy, h("span", { class: "sb-sp" }), stop, send);
  const body = h("div", { class: "sds-body" },
    field("From", fromWords, fromAccount),
    ...(d.to ? [field("In", d.to)] : []),
    ...(d.answers ? [h("blockquote", { class: "sds-quote" }, ...(d.answers.who ? [h("span", { class: "sds-quote-who" }, d.answers.who)] : []), h("span", { class: "sds-quote-t" }, d.answers.words))] : []),
    h("label", { class: "sds-yours" }, h("span", { class: "sds-label" }, d.answers ? "Your reply" : "Your words"), box),
    ...(made ? [made] : []),
    call, toolLine, said, foot);

  const dlg = dialog({
    title: row.text,
    body,
    wide: true,
    // While it sends, Esc and a click outside leave it open: its Stop is here (found by the Hunter on S5c: closed, the
    // row's Discard ran beside the Send, and what went out was marked sent over it). A new page still takes it away.
    guard: () => {
      if (!sending) return true;
      fail("It is being sent: wait for it, or Stop it.");
      return false;
    },
    onClose: () => {
      closed = true;
      if (ticking) clearInterval(ticking);
      // Your changed words are kept in the draft, sent or not (S5c-D7) — and said where they could not be (found by the
      // Hunter on S5c: a failed keep was silent).
      if (!done && words.trim() && words !== kept)
        void request("POST", path, { words }).then((r) => {
          if (!r.ok) toast(`Your words for “${row.text}” were not kept: ${r.error}`, "err");
        });
    },
  });
  dlg.el.querySelector(".zc-dialog")?.classList.add("sds-sheet");

  /** @param {HTMLButtonElement} b @param {string} text */
  const label = (b, text) => {
    const l = b.querySelector(".zc-btn-label");
    if (l) l.textContent = text;
  };
  /** @param {string} text */
  const fail = (text) => {
    said.textContent = text;
    said.hidden = false;
  };

  /** Send, and the rest, as what is known stands. */
  function paint() {
    // Another sheet sends it now: this one's Send waits, and its Stop stops that Send (found by the Hunter on S5c).
    const elsewhere = !!look?.sending && !sending;
    const ready = !!look?.tool.ok && !!words.trim() && !sending && !elsewhere;
    send.disabled = !ready;
    send.title = !look ? `Asking ${d.connection} first` : elsewhere ? "It is being sent from another sheet" : !look.tool.ok ? look.tool.words : !words.trim() ? "Your words are empty" : `Calls ${d.connection} › ${d.tool} with your words${account ? `, as ${account}` : ""}`;
    if (elsewhere) {
      stop.hidden = false;
      stop.disabled = false;
    }
    discard.disabled = sending || elsewhere;
    copy.disabled = sending;
    ask.disabled = sending || !askChat || !look?.chat;
    ask.title = !look ? "" : look.chat ? `Opens “${look.chat.name}”, which wrote it, with your ask in its box: nothing is sent until you send it there` : "The chat that wrote it is gone: ask in another, or change the words here";
    box.disabled = sending;
    fromAccount.disabled = sending;
  }

  /** The newest ask: an older answer, come late, is not drawn. */
  let asking = 0;
  /** What its server says now — as the account picked —, drawn. @param {string} [as] */
  async function read(as) {
    const mine = ++asking;
    toolLine.textContent = `Asking ${d.connection} whether ${d.tool} sends…`;
    toolLine.classList.remove("is-off");
    toolLine.hidden = false;
    const r = await request("GET", `${path}/draft${as ? `?account=${encodeURIComponent(as)}` : ""}`);
    if (closed || mine !== asking) return;
    if (!r.ok) {
      toolLine.textContent = r.error;
      toolLine.classList.add("is-off");
      look = null;
      return paint();
    }
    look = /** @type {DraftLook} */ (r.got);
    // The words the draft keeps now — yours, kept as an earlier sheet closed —, where you have not typed here yet (found
    // by the Hunter on S5c: the row the sheet opened from still held the agent's, and Send sent them over yours).
    const theirs = look.row?.draft?.words;
    if (typeof theirs === "string" && theirs !== kept && words === kept) {
      words = kept = theirs;
      box.value = theirs;
    }
    account = look.from.account;
    fromWords.textContent = look.from.accounts.length > 1 ? `${d.connection} ·` : account ? `${d.connection} · ${account}` : d.connection;
    fromAccount.hidden = look.from.accounts.length < 2;
    fromAccount.replaceChildren(...look.from.accounts.map((a) => h("option", { value: a, ...(a === account ? { selected: "" } : {}) }, a)));
    // It sends: the call's own line above says through what, so this one goes (seen live: the words twice).
    toolLine.textContent = look.tool.ok ? "" : `Send is off: ${look.tool.words}`;
    toolLine.classList.toggle("is-off", !look.tool.ok);
    toolLine.hidden = look.tool.ok;
    if (look.sending) fail("It is being sent from another sheet: wait for it, or Stop it; open it again once it ended.");
    paint();
  }

  box.addEventListener("input", () => {
    words = box.value;
    paint();
  });
  // Another account: Send goes as it at once, off until its server is asked as it.
  fromAccount.addEventListener("change", () => {
    account = fromAccount.value;
    look = null;
    paint();
    void read(account);
  });

  discard.addEventListener("click", async () => {
    const r = await request("POST", path, { discard: true });
    if (!r.ok) return fail(r.error);
    done = true;
    toast(`Discarded “${row.text}”: Done today's Bring back puts it back`);
    dlg.close(true);
  });
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(words).then(() => toast("Your words are copied"), () => toast("They could not be copied: select them and copy", "err"));
  });
  ask.addEventListener("click", () => {
    if (!askChat || !look?.chat) return;
    dlg.close(true);
    askChat(d.chain, draftAsk(row));
  });
  stop.addEventListener("click", () => {
    stop.disabled = true;
    void request("POST", `${path}/send/stop`, {}).then((r) => {
      if (!r.ok && !closed) fail(r.error);
    });
  });
  send.addEventListener("click", async () => {
    if (send.disabled || sending) return;
    sending = true;
    said.hidden = true;
    const from = Date.now();
    stop.hidden = false;
    stop.disabled = false;
    const tick = () => label(send, `Sending… ${Math.round((Date.now() - from) / 1000)} s`);
    tick();
    ticking = setInterval(tick, 1000);
    paint();
    const r = await request("POST", `${path}/send`, { words, ...(account ? { account } : {}) });
    sending = false;
    if (ticking) clearInterval(ticking);
    ticking = null;
    label(send, "Send");
    stop.hidden = true;
    // Answered, the server kept your words before it called, whatever came of it; refused, closing keeps them.
    if (r.ok) kept = words;
    if (r.ok && r.got?.sent) {
      done = true;
      toast(`Sent “${row.text}” through ${d.connection} › ${d.tool}${r.got.link ? `: ${r.got.link}` : ""}`);
      if (!closed) dlg.close(true);
      return;
    }
    const why = r.ok ? String(r.got?.error || "it said nothing") : r.error;
    if (closed) toast(`“${row.text}” was not sent: ${why}`, "err");
    else {
      fail(r.ok ? `Not sent: ${why}` : why);
      paint();
    }
  });

  paint();
  void read();
  box.focus();
  return { close: () => dlg.close(true) };
}
