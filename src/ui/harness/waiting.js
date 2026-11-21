// @ts-check
// The harness queue (HarnessV3 Step 3, D14): a send that finds the chat held (moving to another folder, or running a
// turn a coding agent began by itself) stays with the chat and sends itself when that ends — the harness is the only
// screen that can show a queue, so it lives here, not on the server. DOM-free: the app wires the row, this module holds
// the behaviour.
import { api } from "./lib/api.js";
import { workingWords } from "./lib/labels.js";

/**
 * The queue's one line (§5): "Waiting — Claude Code is working on its own · 2 min · idle 40 s". The words are the
 * server's (Facade D13): the holder snapshot carries `label`, and the page maps no ids of its own.
 * @param {{ window?: string | null, client?: string | null, label?: string | null, since?: number, idleMs?: number, own?: { agent: string } | null } | null} holder
 * @param {() => number} [now]
 */
export function queueText(holder, now = () => Date.now()) {
  if (!holder) return "Waiting — the turn is ending";
  const mins = Math.max(1, Math.round((now() - (holder.since ?? now())) / 60_000));
  const idle = Math.max(0, Math.round((holder.idleMs || 0) / 1000));
  return `Waiting — ${workingWords(holder)} · ${mins} min · idle ${idle} s`;
}

/**
 * The toast when a send meets the chat held (D14): the message waits and sends itself when that ends — a coding agent's
 * turn of its own (HarnessV3-ACP AC3-9) named as such, else the chat's move.
 * @param {{ window?: string | null, client?: string | null, label?: string | null, own?: { agent: string } | null } | null} holder
 */
export function waitingToast(holder) {
  return holder?.own
    ? `${holder.own.agent} is working on its own — the message waits and sends itself when it's done`
    : "This chat is moving to another folder — the message waits and sends itself once it has moved";
}

/**
 * Who holds the turn, as the queue's `free` reads it (Facade D7/FC 13): the session view's holder — verbatim,
 * a null meaning "the turn ended, send" — the moment the view exists (the 409 itself creates it). A stale
 * holder resurrected by a fallback (`||`) would keep a finished turn waiting forever. The holder captured at
 * arm time only covers a chat whose view was never applied at all.
 * @param {{ view?: { holder: any } | null }} chat
 * @param {any} captured  the holder the queue was armed with
 * @returns {any} the holder, or null when the turn has ended
 */
export function holderFromView(chat, captured) {
  if (chat?.view) return chat.view.holder; // the view speaks verbatim — a null means the turn ended, send
  return captured; // no view yet (the session was never applied): the arm-time holder stands
}

/** The turn lock's window while a chat moves to another folder (app/sessions/move.js `MOVE_WINDOW`): Filament's own. */
export const MOVE_WINDOW = "move";

/**
 * The waiting send (D14): held in the chat, sent by itself when the running turn ends. `free` is asked on a
 * timer (the session view's holder, which the events feed keeps current; this poll is the queue's own simple arm) —
 * it returns the holder, or null once the turn has ended.
 * `send` answers null when the message went, or the NEW holder when a racing send won the lock first (the
 * two-tabs rule: this queue simply waits again) — anything else (the page refused the send) re-arms with the
 * same holder. Two tabs waiting: each sends itself; the server's lock answers 409 to the second.
 * `shown` says whether the queue's own chat is on screen. The page sends through its composer path, which sends
 * into the chat on screen, so while another chat is shown the queue holds — it neither asks, nor sends, nor
 * touches the line — and carries on at its next tick once its chat is shown again. It never sends into another
 * session.
 * `post` is the admin client the Stop goes through (the page's own; a test hands in its stand-in).
 * @param {{ content: any, holder: any, free: () => Promise<any | null>, send: (content: any) => Promise<any | null>, onTick?: (text: string) => void, pollMs?: number, shown?: () => boolean, post?: (path: string, init?: { method?: string }) => Promise<any> }} o
 */
export function createWaitingQueue({ content, holder, free, send, onTick = () => {}, pollMs = 2000, shown = () => true, post = api }) {
  let cancelled = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  const tick = async () => {
    if (cancelled) return;
    if (!shown()) {
      timer = setTimeout(tick, pollMs);
      return;
    }
    let held = null;
    try {
      held = await free();
    } catch {
      held = holder; // the answer never came: keep waiting, the next tick asks again
    }
    if (cancelled) return;
    if (!held && !shown()) {
      // The chat was left while `free` was answering: hold rather than send into the chat now on screen.
      timer = setTimeout(tick, pollMs);
      return;
    }
    if (!held) {
      // The turn ended: this tab sends by itself. A racing send may have won the lock first — then `send` comes
      // back with the new holder and the queue re-arms instead of dropping the message.
      const again = await send(content);
      if (cancelled) return;
      if (again) {
        holder = again;
        onTick(queueText(again));
        timer = setTimeout(tick, pollMs);
        return;
      }
      cancelled = true;
      return;
    }
    holder = held;
    onTick(queueText(held));
    timer = setTimeout(tick, pollMs);
  };
  timer = setTimeout(tick, pollMs);
  return {
    get text() {
      return queueText(holder);
    },
    /** Cancel: the message stays unsent (the person can edit and send it by hand). */
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
    /** Stop the running turn instead of waiting — the page offers it for a coding agent's turn of its own (HarnessV3-ACP
     *  AC3-9) — and the queue then frees by itself. The route is the admin API's own path (`/sessions/…/stop`); a
     *  refusal's words go to `onFail`.
     *  @param {string} stopRoute @param {(why: string) => void} [onFail] */
    async stop(stopRoute, onFail = (/** @type {string} */ _why) => {}) {
      try {
        return await post(stopRoute, { method: "POST" });
      } catch (/** @type {any} */ e) {
        onFail(String(e?.message || ""));
        return null;
      }
    },
  };
}

/** Where a waiting send survives a reload (D14: "the waiting message is kept with the chat"). @param {Storage} store */
export function waitingStore(store) {
  const keyOf = (chainId) => `filament.waiting:${String(chainId)}`;
  return {
    /** @param {string} chainId @param {{ text: string, attachments?: any[], holder: any, opts?: any }} payload */
    save(chainId, payload) {
      try {
        store.setItem(keyOf(chainId), JSON.stringify(payload));
      } catch {}
    },
    /** @param {string} chainId */
    read(chainId) {
      try {
        const raw = store.getItem(keyOf(chainId));
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    /** @param {string} chainId */
    clear(chainId) {
      try {
        store.removeItem(keyOf(chainId));
      } catch {}
    },
  };
}

/**
 * Does a hydrated chat owe a waiting row (D14)? The page asks this after a reload: a saved waiting send exists
 * and the chat is still held — then the row is rebuilt and the queue re-armed; when what held it has already ended,
 * the send fires at once.
 * @param {any | null} saved  what waitingStore.read returned
 * @param {any | null} live  the transcript's live (the holder, or null)
 */
export function waitingOwes(saved, live) {
  if (!saved || typeof saved !== "object") return null;
  return { payload: saved, holder: live?.window ? live : null };
}
