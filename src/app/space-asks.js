// @ts-check
// An app's ask, run here (the owner's of 11-04: "some automated agentic work … could run on that model without users
// having to open a chat all the time"): the words an app's page asks an agent for — its `filament.ask`, after a click in
// it —, run as a new chat of its Space at work in the background, on the Space's model and effort (core/space-settings.js)
// or the one the ask's sheet was given, reading only, as a routine that does not write runs. Its first message says what
// it is — whose ask, from which app, what it may do —, then the app's words. The chat is the Space's like any other: its
// lane while it works, Now, and What happened as it finishes (app/space-news.js); a line in What happened says it was
// asked, and another, as its turn lets go, what it answered or why it failed — the person never opened it. Only the
// person's press runs one: the ask's sheet's Run it, or "Run it at once" chosen in Settings › Space.
import { firstLine, tookWords } from "../core/routines.js";
import { SPACE_EFFORTS } from "../core/space-settings.js";

/** The most an app's words may be, as a routine's are: an ask is a task, not a document. */
export const ASK_WORDS_MAX = 8000;

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/**
 * @typedef {{
 *   spaces: import("../services/spaces.js").SpaceStore,
 *   sessions: { create: (o: any) => { id: string }, besideFacts?: (id: string) => { busy: boolean, asking: boolean,
 *     last: { final: boolean, text: string, cut: boolean, failed: boolean, why: string, stopped: boolean } | null } },
 *   postTurn: (chainId: string, body: Record<string, unknown>) => Promise<{ status: number, body: any }>,
 *   mark?: (chainId: string, meta: Record<string, unknown>) => unknown,
 *   folderOf: (project: string) => string | null,
 *   nameOf?: (project: string) => string,
 *   problemOf?: (model: string) => string | null,
 *   chatModel?: (model: string, effort: string) => { name: string, effort: string | null },
 *   remove?: (chainId: string) => Promise<unknown>,
 *   log?: (level: string, msg: string) => void,
 *   now?: () => number,
 * }} AsksDeps
 */

/**
 * The first message of an app's ask run here: what it is and what it may do, then the app's words.
 * @param {{ app: string, space: string, words: string }} o
 */
export function askRunWords({ app, space, words }) {
  return `This is an ask of ${app}, an app of ${space}'s Space, run as the person pressed its button: a chat of its own, working in the background while the person goes on. You read only: change no file, and send nothing. Filament's own tools are yours — an app's data (the artifact tool), the Space (the space tool) — as the app's words need them. When it is done, say what you did in a line or two: the person reads it in What happened.\n\n${words}`;
}

/** An ask's words as What happened quotes them: their first line, 100 characters at most. @param {string} words */
const quoteOf = (words) => {
  const line = firstLine(words);
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
};

/** A chat's title for an app's ask: the app, then its words' first line. @param {string} app @param {string} words */
export const askRunTitle = (app, words) => {
  const line = firstLine(words);
  const t = `${app}: ${line}`;
  return t.length > 90 ? `${t.slice(0, 89)}…` : t;
};

/** @param {AsksDeps} deps */
export function createSpaceAsks({ spaces, sessions, postTurn, mark, folderOf, nameOf = (p) => p, problemOf = () => null, chatModel, remove, log = () => {}, now = Date.now }) {
  /** The asks starting, by project and words: two presses start one. @type {Set<string>} */
  const starting = new Set();
  /**
   * The asks under way, by their chat: whose and since when, for the line their end writes; `begun` once its turn's
   * answer said it began, `early` where its turn let go before — a turn refused as it started (found by the review of
   * 11-04): its end waits for that answer, so a refusal writes no failure for a chat that goes. Kept while Filament runs.
   * @type {Map<string, { project: string, app: string, at: number, begun: boolean, early: boolean }>}
   */
  const running = new Map();
  /**
   * A chat's turn let go (the server's turn lock): where it is an ask's run, its end written in What happened — what it
   * answered, or why it failed or stopped —, once. One that waits for the person goes on.
   * @param {string} chainId
   */
  function released(chainId) {
    const run = running.get(chainId);
    if (!run || !sessions.besideFacts) return;
    if (!run.begun) return void (run.early = true);
    /** @type {ReturnType<NonNullable<AsksDeps["sessions"]["besideFacts"]>>} */
    let f;
    try {
      f = sessions.besideFacts(chainId);
    } catch {
      running.delete(chainId);
      return;
    }
    if (f.busy || f.asking) return;
    running.delete(chainId);
    const l = f.last;
    const text = l?.stopped ? `${run.app}'s ask was stopped before it ended.`
      : l?.final ? `${run.app}'s ask ran (${tookWords(now() - run.at)}): ${firstLine(l.text) || "it said nothing"}`
      : `${run.app}'s ask failed: ${l?.failed && l.why ? l.why : l?.cut ? "Filament stopped before it ended" : "it ended with no answer"}`;
    try {
      spaces.write(run.project, text.length > 600 ? `${text.slice(0, 599)}…` : text, { kind: "filament", chain: chainId });
    } catch (/** @type {any} */ e) {
      log("warn", `space asks: the end of ${run.app}'s ask was not written (${e?.message || e})`);
    }
  }
  return {
    released,
    /**
     * An app's words run as a new read-only chat of the project's Space, on `model` at `effort` where the sheet gave
     * them, else on what the Space runs on. Refused in words: no model to run on, one that cannot run now, words that
     * are none or too long, a project Filament does not know. → its chat, and the model it runs on in words.
     * @param {string} project
     * @param {{ words: unknown, app?: unknown, model?: unknown, effort?: unknown }} ask  `app`: the app's title
     * @returns {Promise<{ chain: string, on: string }>}
     */
    async run(project, ask) {
      const words = typeof ask.words === "string" ? ask.words.trim() : "";
      if (!words) throw refused(400, "words is what the app asks an agent to do");
      if (words.length > ASK_WORDS_MAX) throw refused(400, `an app's ask is ${ASK_WORDS_MAX} characters at most; this one has ${words.length}`);
      const app = typeof ask.app === "string" && ask.app.trim() ? ask.app.trim().slice(0, 80) : "An app";
      const folder = folderOf(project);
      if (!folder) throw refused(404, "Filament does not know this Space's folder");
      const space = spaces.runsOn(project);
      const given = typeof ask.model === "string" && ask.model.trim() ? ask.model.trim() : "";
      if (given && (given.length > 200 || /[\u0000-\u001f\u007f]/.test(given))) throw refused(400, "model is a model's name, 200 characters at most, on one line");
      const asked = typeof ask.effort === "string" ? ask.effort.trim() : "";
      if (asked && !SPACE_EFFORTS.includes(asked)) throw refused(400, `effort is one of ${SPACE_EFFORTS.join(", ")}, or "" for the model's own`);
      const model = given || space.model;
      const effort = given ? asked : space.effort;
      if (!model) throw refused(409, "This Space has no model for its agents yet: choose one for this ask, or set one in Settings › Space.");
      const cannot = problemOf(model);
      if (cannot) throw refused(409, `${model} cannot run now: ${cannot}`);
      const key = `${project}|${words}`;
      if (starting.has(key)) throw refused(409, "This ask is starting already.");
      starting.add(key);
      try {
        const made = effort ? (chatModel ? chatModel(model, effort) : { name: model, effort }) : { name: model, effort: null };
        const on = `${model}${effort ? ` · ${effort}` : ""}`;
        /** @type {{ id: string }} */
        let chat;
        try {
          chat = sessions.create({ cwd: folder, model: made.name, title: askRunTitle(app, words), settings: { loop: { permissions: "read-only" }, ...(made.effort ? { model: { effort: made.effort } } : {}) } });
        } catch (/** @type {any} */ e) {
          throw refused(502, `its chat could not be made: ${e?.message || e}`);
        }
        // Known as an ask before its turn begins: one that ends at once is still read as one, once its turn said it began.
        const run = { project, app, at: now(), begun: false, early: false };
        running.set(chat.id, run);
        // Its chat names the ask it runs (`meta.ask`): its first message is Filament's, an ask's run (core/turn-by.js),
        // which the turn takes only in a chat so marked.
        mark?.(chat.id, { ask: { project, app, at: run.at } });
        /** @type {{ status: number, body: any }} */
        let res;
        try {
          res = await postTurn(chat.id, { by: "ask", content: [{ type: "text", text: askRunWords({ app, space: nameOf(project), words }) }] });
        } catch (/** @type {any} */ e) {
          res = { status: 502, body: { error: String(e?.message || e) } };
        }
        if (res.status < 200 || res.status >= 300) {
          running.delete(chat.id);
          if (remove) await remove(chat.id).catch((/** @type {any} */ e) => log("warn", `space asks: the chat of an ask that could not start stays (${e?.message || e})`));
          throw refused(502, `its turn could not start: ${String(res.body?.error || `HTTP ${res.status}`)}`);
        }
        run.begun = true;
        try {
          spaces.write(project, `${app} asked an agent: “${quoteOf(words)}” — it runs in the background on ${on}, reading only.`, { kind: "filament", chain: chat.id });
        } catch (/** @type {any} */ e) {
          log("warn", `space asks: the line of ${app}'s ask was not written (${e?.message || e})`);
        }
        // A turn that let go before its answer came: its end, read now, after the line that says it was asked.
        if (run.early) released(chat.id);
        log("info", `space asks: ${app}'s ask runs in ${project} (${chat.id}, on ${on})`);
        return { chain: chat.id, on };
      } finally {
        starting.delete(key);
      }
    },
  };
}

/** @typedef {ReturnType<typeof createSpaceAsks>} SpaceAsks */
