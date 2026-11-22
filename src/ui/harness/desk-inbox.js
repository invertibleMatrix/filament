// @ts-check
// The desk's inbox (the remote desk of 11-22): what waits for you on another machine is answered here, without the
// window going to that machine. Each other machine's chat in Now's Needs you has its waiting asks read through the app
// (harness-preload.cjs `filamentMachines.call`, op `asks`) — its own turn's question or permission, its coding agent's,
// its sub-agents' — and drawn as cards under its row: the question, the command, a button for each of its answers, a
// box where words answer it, and Open for the whole card in its chat. A press goes as an answer there (op `answer`),
// the machine's own judge of it: answered, its card goes at once; refused, its words say why. What a card could show
// only a part of — a plan, a form, a link, a secret, a command too long — it answers with Open alone.
//
// Every answer is that machine's words, of any version: each ask is read field by field (`readAsks`) — ids by the
// pattern the desk sends, words clipped, its answers capped —, and an ask with an answer the desk could not send shows
// none. A chat's asks are read again as its machine says one opened or settled, or its turn began or ended (desk frames
// `ask`, `turn`), every chat of a machine as its stream joins again (`hello`), and a machine that says no `ask-events`
// as the app tells this page its rows moved.

/** An ask's id, as the desk sends one (desktop/lib/desk.js `ASK_ID`). */
const ASK_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
/** A sub-agent's id, as an ask's `from` names it. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
/** An answer's id as the desk sends one (desktop/lib/desk.js `choiceOk`): words — a coding agent's are its labels —, no control characters. */
const CHOICE_MOST = 500;
const choiceOk = (/** @type {unknown} */ v) => typeof v === "string" && v.length > 0 && v.length <= CHOICE_MOST && !/[\u0000-\u001f\u007f]/.test(v);
/** The most asks kept of a chat, and answers of an ask: more than any waits. */
const ASKS_MOST = 20;
const OPTIONS_MOST = 12;
/** The longest words kept: a question, an answer's label, a refusal. */
const QUESTION_MOST = 2000;
const LABEL_MOST = 200;
const SAID_MOST = 400;
/** The longest command shown: its machine's own cap (http/admin/sessions.js, adapters/agents/asks.js). One longer is answered in its chat alone. */
const COMMAND_MOST = 20000;
/**
 * The mark its machine ends a command it cut with, within that cap (core/redact.js `redactAndCap`): a command so cut is
 * a part, however long what is left, and Allow would answer the whole.
 */
const CUT_MARK = /…\[truncated \d+ chars\]$/;
/** The longest answer in words the desk sends (desktop/lib/desk.js `WORDS_MAX`). */
export const WORDS_MOST = 20000;
/** How soon a chat's asks are read again after an answer went: its machine has settled it by then. */
export const AGAIN_MS = 1500;
/**
 * How long an answered ask stays hidden while its machine still lists it. Past this its card shows again, answered
 * in its chat alone (`STILL_LISTED`): its answer was taken, so a press here would be refused as answered already.
 */
export const ANSWERED_MS = 120_000;
/** An answered ask its machine still lists past `ANSWERED_MS`, in its card's words. */
export const STILL_LISTED = "Answered here, still waiting there: open the chat";
/** The most reads of one machine's asks under way at once: the desk takes 8 calls a machine, and an answer needs one. */
export const READS_MOST = 3;
/** A first read that failed goes again after this, `TRIES` times at most; then at the chat's next frame or the desk's next word. */
export const RETRY_MS = 5000;
const TRIES = 3;

/**
 * An ask waiting in another machine's chat, as this page reads it (http/admin/sessions.js `Ask`): its id there, what
 * it is, who asks (`chat`, `coding-agent`, or a sub-agent's id), its words, the command it would run, the answers that
 * answer it (each pressed as its `choice`), whether words answer it, and when it was asked. `apart`: why it is answered
 * in its chat alone, "" where it is answered here — a plan, a form, a link or a secret, or a command too long to show
 * whole, is never answered from a card that shows a part of it.
 * @typedef {{ id: string, kind: "permission" | "question" | "other", from: string, question: string, command: string,
 *   options: { id: string, label: string }[], words: boolean, at: number, apart: string }} DeskAsk
 */

/** Words as kept: a string, its control characters but newlines gone, `most` at most. @param {unknown} v @param {number} most */
const words = (v, most) => (typeof v === "string" ? v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").slice(0, most).trim() : "");

/** Why an ask is answered in its chat alone, "" for one answered here. @param {any} a @param {DeskAsk["kind"]} kind @param {boolean} cut */
const apartOf = (a, kind, cut) => {
  if (kind === "other") return a.kind === "plan" || a.kind === "proposal" ? "Its plan is read whole in its chat" : "Answer it in its chat";
  if (cut) return "Its command is too long to show here";
  if (a.form?.questions?.some?.((/** @type {any} */ q) => q?.words === "secret")) return "It asks for a secret: answer it in its chat";
  // A permission is answered here by the command it shows: an edit's — its diff its chat's alone —, or a tool's with
  // none to show, is answered where its card is whole.
  const judged = a.form?.judged;
  if (kind === "permission" && (typeof a.command !== "string" || !a.command.trim() || (Array.isArray(judged?.changes) && judged.changes.length) || Number(judged?.changesLeft) > 0))
    return "Its changes are shown in its chat";
  return "";
};

/**
 * A chat's asks as its machine answered them (`GET /sessions/:id/asks`), each field checked or dropped; none for what is
 * no list. @param {unknown} json @returns {DeskAsk[]}
 */
export function readAsks(json) {
  const list = /** @type {any} */ (json)?.asks;
  if (!Array.isArray(list)) return [];
  /** @type {DeskAsk[]} */
  const out = [];
  for (const a of list.slice(0, ASKS_MOST)) {
    if (!a || typeof a !== "object" || typeof a.id !== "string" || !ASK_ID.test(a.id) || out.some((x) => x.id === a.id)) continue;
    /** @type {DeskAsk["kind"]} */
    const kind = a.kind === "permission" || a.kind === "question" ? a.kind : "other";
    const from = a.from === "chat" || a.from === "coding-agent" || (typeof a.from === "string" && ID.test(a.from)) ? a.from : "chat";
    const raw = Array.isArray(a.options) ? a.options : [];
    const options = raw.slice(0, OPTIONS_MOST).filter((/** @type {any} */ o) => o && choiceOk(o.id)).map((/** @type {any} */ o) => ({ id: o.id, label: words(o.label, LABEL_MOST) || words(o.id, LABEL_MOST) }));
    const command = typeof a.command === "string" ? a.command : "";
    const apart = apartOf(a, kind, command.length > COMMAND_MOST || CUT_MARK.test(command));
    // An answer it says that the desk cannot send, or more than a card holds, leaves it no answers at all here: a card
    // never shows some of them.
    const whole = options.length === raw.length;
    const at = Number(a.at);
    out.push({
      id: a.id, kind, from, question: words(a.question, QUESTION_MOST), command: words(command, COMMAND_MOST),
      options: apart || !whole ? [] : options, words: !apart && whole && a.words === true && kind !== "permission",
      at: Number.isFinite(at) && at > 0 ? at : 0, apart: apart || (whole ? "" : "Answer it in its chat"),
    });
  }
  return out;
}

/** A chat's place in the inbox: its machine's id and its chat's id there. @param {string} machine @param {string} chain */
const chatKey = (machine, chain) => `${machine}/${chain}`;

/**
 * @typedef {import("./lib/desk.js").DeskRow} DeskRow
 * @typedef {{ call?: (p: any) => Promise<any>, onEvent?: (fn: (f: any) => void) => (() => void) | void }} Bridge
 * @typedef {{ machine: string, chain: string, asks: DeskAsk[], reading: boolean, again: boolean, read: boolean, tries: number }} Chat
 */

/**
 * The inbox over the app's bridge: `sync` with Now's Needs-you rows of the other machines, `cardsOf` a row's cards.
 * `onChange`: what it would draw moved; `later`: the page's timer, a test's own. `focusIn`: the card the page's focus is
 * in (its `data-key`), and `focusRow` a row given it: an answered card's focus goes to its row, not to nowhere.
 * @param {{ bridge?: Bridge | null, onChange: () => void, later?: (fn: () => void, ms: number) => unknown, now?: () => number,
 *   focusIn?: () => string | null, focusRow?: (row: DeskRow) => void }} o
 */
export function createDeskInbox(o) {
  const bridge = o.bridge || null;
  const later = o.later || ((fn, ms) => setTimeout(fn, ms));
  const now = o.now || Date.now;
  /** The chats read, by `chatKey`. @type {Map<string, Chat>} */
  const chats = new Map();
  /** Each chat's threads with a row of their own in Needs you: their asks are theirs, never the chat's row's. @type {Map<string, Set<string>>} */
  let threadRows = new Map();
  /** Asks answered here, by `chatKey/ask`, at the moment: hidden while their machine still lists them. @type {Map<string, number>} */
  const answered = new Map();
  /** Asks whose answer is on its way. @type {Set<string>} */
  const sending = new Set();
  /** A refusal's words, by ask. @type {Map<string, string>} */
  const said = new Map();
  /** An answer in words as it is typed, by ask: a draw that is no focus's keeps it. @type {Map<string, string>} */
  const drafts = new Map();
  /** Each machine's reads under way, and the chats that wait for one of its turns (`READS_MOST`). @type {Map<string, number>} */
  const reading = new Map();
  /** @type {Map<string, Chat[]>} */
  const queued = new Map();
  let rev = 0;
  const moved = () => {
    rev++;
    o.onChange();
  };
  /** Whether a chat is still the one the inbox keeps. @param {Chat} c */
  const kept = (c) => chats.get(chatKey(c.machine, c.chain)) === c;

  /**
   * A chat's asks read: one read of a chat at a time — one asked meanwhile goes after it —, `READS_MOST` of a machine's,
   * the rest waiting their turn. Only what moved is drawn again.
   * @param {Chat} c
   */
  async function read(c) {
    if (!bridge?.call || !kept(c)) return;
    if (c.reading) {
      c.again = true;
      return;
    }
    if ((reading.get(c.machine) || 0) >= READS_MOST) {
      const q = queued.get(c.machine) || [];
      if (!q.includes(c)) queued.set(c.machine, [...q, c]);
      return;
    }
    c.reading = true;
    reading.set(c.machine, (reading.get(c.machine) || 0) + 1);
    try {
      const a = await bridge.call({ op: "asks", machine: c.machine, chat: c.chain }).catch(() => null);
      if (!kept(c)) return;
      if (!a?.ok) {
        // One its machine would not answer keeps what was read — a dropped link takes no card away —; a first read
        // goes again a moment later, a few times.
        if (!c.read && c.tries < TRIES) {
          c.tries++;
          later(() => void (kept(c) && !c.read && read(c)), RETRY_MS);
        }
        return;
      }
      const next = readAsks(a.json);
      const same = c.read && JSON.stringify(next) === JSON.stringify(c.asks);
      c.asks = next;
      c.read = true;
      const listed = new Set(c.asks.map((x) => `${chatKey(c.machine, c.chain)}/${x.id}`));
      const prefix = `${chatKey(c.machine, c.chain)}/`;
      let settled = false;
      for (const m of [answered, said, drafts])
        for (const k of [...m.keys()])
          if (k.startsWith(prefix) && !listed.has(k)) {
            m.delete(k);
            settled = true;
          }
      if (!same || settled) moved();
    } finally {
      c.reading = false;
      const left = (reading.get(c.machine) || 1) - 1;
      if (left) reading.set(c.machine, left);
      else reading.delete(c.machine);
      if (c.again) {
        c.again = false;
        void read(c);
      }
      const q = queued.get(c.machine) || [];
      while (q.length && (reading.get(c.machine) || 0) < READS_MOST) void read(/** @type {Chat} */ (q.shift()));
      if (!q.length) queued.delete(c.machine);
    }
  }

  /**
   * Now's Needs-you rows of the other machines, as the bar draws them: each one's chat read where it was not, or its last
   * read failed, and again where its machine says no `ask-events`; a chat no row names any more let go.
   * @param {readonly DeskRow[]} rows @param {(machine: string) => readonly string[]} flagsOf
   */
  function sync(rows, flagsOf) {
    /** @type {Map<string, Set<string>>} */
    const threads = new Map();
    const wanted = new Set();
    for (const r of rows) {
      const k = chatKey(r.machine.id, r.there.chain);
      wanted.add(k);
      if (r.there.thread) threads.set(k, new Set([...(threads.get(k) || []), r.there.thread]));
    }
    threadRows = threads;
    let gone = false;
    for (const k of [...chats.keys()]) {
      if (wanted.has(k)) continue;
      chats.delete(k);
      // What its cards kept — answers sent, a refusal's words, an answer half typed — goes with it.
      for (const m of [answered, said, drafts]) for (const a of [...m.keys()]) if (a.startsWith(`${k}/`)) m.delete(a);
      gone = true;
    }
    /** Each chat once, whatever rows of its threads stand beside its own. */
    const asked = new Set();
    for (const r of rows) {
      const k = chatKey(r.machine.id, r.there.chain);
      if (asked.has(k)) continue;
      asked.add(k);
      const had = chats.get(k);
      if (had?.read && flagsOf(r.machine.id).includes("ask-events")) continue;
      const c = had || { machine: r.machine.id, chain: r.there.chain, asks: [], reading: false, again: false, read: false, tries: 0 };
      if (!had) chats.set(k, c);
      void read(c);
    }
    if (gone) moved();
  }

  /**
   * A frame of a machine's events stream, as the app tells it (desktop/lib/desk.js `frameOf`): a chat's asks read again
   * as one opens or settles, or its turn begins or ends; every chat of a machine whose stream joined again.
   * @param {any} f
   */
  function heard(f) {
    if (!f || typeof f.machine !== "string") return;
    for (const c of chats.values()) {
      if (c.machine !== f.machine) continue;
      if (f.type === "hello" || ((f.type === "ask" || f.type === "turn") && f.chain === c.chain)) void read(c);
    }
  }

  /**
   * The asks a row's cards draw: a thread's row its own, the chat's row the rest; those answered here not while their
   * machine settles them, and one it lists long after answered in its chat alone. @param {DeskRow} r @returns {DeskAsk[]}
   */
  function asksOf(r) {
    const k = chatKey(r.machine.id, r.there.chain);
    const c = chats.get(k);
    if (!c) return [];
    const theirs = threadRows.get(k) || new Set();
    const t = now();
    return c.asks.flatMap((a) => {
      if (!(r.there.thread ? a.from === r.there.thread : !theirs.has(a.from))) return [];
      const was = answered.get(`${k}/${a.id}`);
      if (was == null) return [a];
      return t - was < ANSWERED_MS ? [] : [{ ...a, options: [], words: false, apart: STILL_LISTED }];
    });
  }

  /**
   * An answer sent: a choice of its answers, or its words. Answered, its card goes at once — the focus it held to its
   * row — and its chat is read again a moment later; refused, its machine's words stay on its card, and its chat is read
   * again too, so one settled there meanwhile goes. @param {DeskRow} r @param {DeskAsk} a
   * @param {{ choice: string } | { words: string }} with_
   */
  async function answer(r, a, with_) {
    const k = `${chatKey(r.machine.id, r.there.chain)}/${a.id}`;
    if (!bridge?.call || sending.has(k)) return;
    sending.add(k);
    said.delete(k);
    moved();
    const got = await bridge.call({ op: "answer", machine: r.machine.id, chat: r.there.chain, ask: a.id, ...with_ }).catch(() => null);
    sending.delete(k);
    const focused = o.focusIn?.() === `ask:${k}`;
    if (got?.ok) {
      answered.set(k, now());
      drafts.delete(k);
    } else said.set(k, words(got?.words, SAID_MOST) || `${r.machine.name} did not take the answer: open the chat to answer it there.`);
    const c = chats.get(chatKey(r.machine.id, r.there.chain));
    if (c) later(() => void read(c), AGAIN_MS);
    moved();
    if (got?.ok && focused) o.focusRow?.(r);
  }

  /** A card's head words: what it asks, in its kind's words where it says none. @param {DeskAsk} a */
  const headOf = (a) => a.question || (a.kind === "permission" ? "May it run this?" : "It asks you.");

  /**
   * A row's cards, drawn with the page's `h`: none for a row with no ask read, or with no bridge to answer through.
   * `away`: its machine's words while it does not answer, its answers held. `onOpen`: the chat opened there. While an
   * answer goes its card's presses do nothing (`aria-disabled`), and keep the focus they have.
   * @param {DeskRow} r @param {(tag: string, attrs?: any, ...kids: any[]) => any} mk @param {{ away?: string, onOpen: () => void }} w
   */
  function cardsOf(r, mk, w) {
    if (!bridge?.call || r.group !== "needs") return [];
    return asksOf(r).map((a) => {
      const k = `${chatKey(r.machine.id, r.there.chain)}/${a.id}`;
      const busy = sending.has(k);
      const away = w.away || "";
      const hold = { ...(away ? { disabled: "" } : {}), ...(busy ? { "aria-disabled": "true" } : {}) };
      const send = (/** @type {{ choice: string } | { words: string }} */ x) => void answer(r, a, x);
      const box = a.words
        ? mk("input", {
          class: "desk-ask-words",
          type: "text",
          "data-key": `words:${k}`,
          maxlength: String(WORDS_MOST),
          placeholder: a.options.length ? "Or answer in words, Enter sends" : "Your answer, Enter sends",
          value: drafts.get(k) || "",
          "aria-label": `Answer in words on ${r.machine.name}`,
          ...(away ? { disabled: "", title: away } : {}),
          ...(busy ? { readonly: "" } : {}),
          oninput: (/** @type {any} */ e) => void drafts.set(k, String(e.target?.value ?? "")),
          onkeydown: (/** @type {any} */ e) => {
            if (e.key !== "Enter" || e.isComposing) return;
            e.preventDefault();
            const v = String(e.target?.value ?? drafts.get(k) ?? "").trim();
            if (v) send({ words: v.slice(0, WORDS_MOST) });
          },
        })
        : null;
      return mk("div", { class: `desk-ask${busy ? " is-busy" : ""}`, "data-key": `ask:${k}`, role: "group", "aria-label": `${r.machine.name} asks: ${headOf(a)}`, ...(busy ? { "aria-busy": "true" } : {}) },
        mk("div", { class: "desk-ask-q", title: a.question || undefined }, headOf(a)),
        a.command ? mk("pre", { class: "desk-ask-cmd", tabindex: "0", "aria-label": "Its command" }, a.command) : null,
        mk("div", { class: "desk-ask-acts" },
          ...a.options.map((x, i) => mk("button", {
            class: `desk-ask-btn${i === 0 && a.kind === "permission" ? " is-go" : ""}`,
            type: "button",
            title: away || `Answer on ${r.machine.name}: ${x.label}`,
            ...hold,
            onclick: () => send({ choice: x.id }),
          }, x.label)),
          a.apart || (!a.options.length && !a.words) ? mk("span", { class: "desk-ask-none" }, a.apart || "Answer it in its chat") : null,
          mk("button", { class: "desk-ask-btn desk-ask-open", type: "button", title: `Open this chat on ${r.machine.name}, its card whole`, onclick: () => w.onOpen() }, "Open")),
        box,
        said.has(k) ? mk("div", { class: "desk-ask-said", role: "status" }, said.get(k)) : null);
    });
  }

  const off = bridge?.onEvent?.((f) => heard(f));

  return {
    sync,
    heard,
    cardsOf,
    /** What the cards would draw, in a word: Now draws again when it moved. */
    key: () => String(rev),
    /** Its listener let go. */
    close: () => {
      if (typeof off === "function") off();
    },
  };
}
