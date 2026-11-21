// @ts-check
// A draft's sheet and its Send (HarnessV4_Space_Plan S5c, SG-D16, the mock's screen 13). As the sheet opens: From —
// the connection and the account it sends as, with the accounts signed in at its server's address to pick from —,
// whether its tool can send, and whether the chat that wrote it is still there (for Ask for a change…). The person's
// Send: the words as they left them kept first, then the draft's args with those words where "{words}" stands — and
// nothing else changed — called through the project's connection as the account picked, with no clock: it ends, or
// Stop stops it. Sent: Done today, a line in What happened with the first link the tool's answer gave. Failed: the
// draft waits with the person's words. Only the person's Send sends (R2): no agent reaches this.
import { fillWords } from "../core/space.js";
import { accountWords } from "../core/oauth.js";

/** @typedef {import("../core/space.js").NeedRow} NeedRow */
/**
 * The account a server signs in with for a project, and those signed in at its address (S4b) — null for a server that
 * signs in its own way (one on this computer, or one carrying its own Authorization), whose From names it alone.
 * @typedef {{ account: string, accounts: string[] } | null} FromAccounts
 */

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/** The first link a tool's answer gives — a message's address, as What happened says it — or null. @param {string} text */
export function firstLink(text) {
  const m = /https?:\/\/[^\s<>"'`)\]]+/.exec(String(text || ""));
  return m ? m[0].replace(/[.,;:!?]+$/, "") : null;
}

/**
 * @param {{ spaces: import("../services/spaces.js").SpaceStore,
 *   tools: { sendable: (project: string, tool: { connection: string, name: string }, account?: string) => Promise<{ ok: boolean, words: string }>,
 *     send: (project: string, tool: { connection: string, name: string }, args: Record<string, unknown>, account?: string, signal?: AbortSignal) => Promise<import("../core/dashboard-sources.js").ActionOut> },
 *   accounts: (project: string, connection: string) => FromAccounts, chatOf: (chain: string) => { name: string } | null,
 *   log?: (level: string, msg: string) => void }} deps
 *   `tools`: a connection's tools (app/space-tools.js); `accounts`: a server's accounts for a project; `chatOf`: a chat
 *   that is still there
 */
export function createDrafts({ spaces, tools, accounts, chatOf, log = () => {} }) {
  /** Sends under way, by project and row: one at a time for a draft, and Stop stops it. @type {Map<string, AbortController>} */
  const sending = new Map();
  /** @param {string} project @param {string} row */
  const keyOf = (project, row) => `${project}\n${row}`;

  /** A draft of a project's Space, or the refusal. @param {string} project @param {string} row @returns {NeedRow & { draft: import("../core/space.js").Draft }} */
  function draftOf(project, row) {
    const n = spaces.get(project).needs.find((x) => x.id === row);
    if (!n?.draft) throw refused(404, `There is no draft "${String(row).slice(0, 40)}" in this Space.`);
    return /** @type {any} */ (n);
  }

  /** Why a draft no longer sends, or "". @param {NeedRow} n */
  const over = (n) => (n.state !== "done" ? "" : n.outcome === "sent" ? "It was sent." : "It is discarded: Bring back puts it back.");

  /**
   * The accounts From picks from: the one the draft was written with first, then the project's pick, then the others
   * signed in at the address.
   * @param {import("../core/space.js").Draft} d @param {FromAccounts} from
   */
  const choices = (d, from) => (from ? [...new Set([d.account, from.account, ...from.accounts].filter(Boolean).map(accountWords))] : []);

  return {
    /**
     * The sheet as it opens, or as From picks another account: the draft, From and its choices, whether its tool can
     * send as that account (the server asked now), the chat that wrote it, and whether it is being sent.
     * @param {string} project @param {string} row @param {string} [account]
     */
    async look(project, row, account) {
      const n = draftOf(project, row);
      const d = n.draft;
      const from = accounts(project, d.connection);
      const list = choices(d, from);
      const as = from ? accountWords(account && list.includes(accountWords(account)) ? account : d.account || from.account) : "";
      const ended = over(n);
      const tool = ended ? { ok: false, words: ended } : await tools.sendable(project, { connection: d.connection, name: d.tool }, as || undefined);
      const chat = chatOf(d.chain);
      return { row: n, from: { connection: d.connection, account: as, accounts: list }, tool, chat: chat ? { name: chat.name } : null, sending: sending.has(keyOf(project, row)) };
    },

    /**
     * The person's Send (S5c, R2): their words kept in the draft first, so a failure keeps them; then its tool called
     * with exactly those words where "{words}" stands, as the account picked. Refused while it is being sent, once it
     * was sent or discarded, and for an account not signed in at its address.
     * @param {string} project @param {string} row @param {{ words: unknown, account?: unknown }} o
     * @returns {Promise<{ sent: true, said: string, link: string | null, row: NeedRow } | { sent: false, error: string, row: NeedRow }>}
     */
    async send(project, row, { words, account }) {
      const n = draftOf(project, row);
      const ended = over(n);
      if (ended) throw refused(409, ended);
      if (typeof words !== "string") throw refused(400, "words is what is sent: the draft's words as you left them");
      const k = keyOf(project, row);
      if (sending.has(k)) throw refused(409, "It is being sent: wait for it, or stop it.");
      const d = /** @type {import("../core/space.js").Draft} */ (spaces.needChange(project, row, { words }).draft);
      const from = accounts(project, d.connection);
      const list = choices(d, from);
      const as = from ? accountWords(account ? String(account) : d.account || from.account) : "";
      if (from && !list.includes(as)) throw refused(400, `${d.connection} has no account "${as.slice(0, 40)}" signed in: From picks one of ${list.join(", ")}.`);
      const stop = new AbortController();
      sending.set(k, stop);
      try {
        const out = await tools.send(project, { connection: d.connection, name: d.tool }, fillWords(d.args, d.words), from ? as : undefined, stop.signal);
        if (out.ok) {
          const link = firstLink(out.said);
          return { sent: true, said: out.said, link, row: spaces.draftSent(project, row, { words: d.words, as, link }) };
        }
        // Stopped once the call went out: the service may have it (the server is told to cancel, what it did stays done).
        const error = !stop.signal.aborted
          ? out.error
          : out.sent === true
            ? `You stopped it after it went out: ${d.connection} may have sent it — look there before sending again.`
            : "You stopped it before it went out: nothing was sent.";
        log("warn", `drafts: "${n.text}" was not sent through ${d.connection} › ${d.tool} (${error})`);
        return { sent: false, error, row: draftOf(project, row) };
      } finally {
        sending.delete(k);
      }
    },

    /**
     * Whether a draft is being sent now: while it is, its row is neither discarded, done nor rewritten — what goes out
     * would be marked sent over it (found by the Hunter on S5c). @param {string} project @param {string} row
     */
    sending: (project, row) => sending.has(keyOf(project, row)),

    /**
     * Whether any draft of a project's Space is being sent now: while one is, the Space is not deleted — what goes out
     * would be marked sent in a Space that is gone (found by the Hunter on Space optional). @param {string} project
     */
    sendingIn: (project) => [...sending.keys()].some((k) => k.startsWith(`${project}\n`)),

    /**
     * The Send under way, stopped (its sheet's Stop). False where nothing is being sent.
     * @param {string} project @param {string} row
     */
    stop(project, row) {
      const s = sending.get(keyOf(project, row));
      if (!s) return false;
      s.abort();
      return true;
    },
  };
}

/** @typedef {ReturnType<typeof createDrafts>} Drafts */
