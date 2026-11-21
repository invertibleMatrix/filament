// @ts-check
// The chats the page lets go of (the bench of 10-25: every chat opened stayed in `state.chats` with its transcript
// whole, and a page open all day only grew — 19 → 122 MB over one long turn among 60 chats). The open chat and the few
// shown last are kept; an older one goes once nothing of it lives only in the page: its session is in the archive's
// list, so the sidebar draws its row from there, and opening it again reads it again from its session. The view it
// showed and the cards opened on it are kept apart, small, so it opens as it was left.

/** How many chats are kept besides the open one, the most recently shown first. */
export const KEEP_SHOWN = 4;

/**
 * Whether a chat holds nothing the page alone has: a session in the archive's list, no turn of its own running or
 * waiting to send, no message queued, no ask paused on it, no summon, resume or compaction armed.
 * @param {any} chat @param {Set<string>} known  the archive's session ids
 */
export function letGoable(chat, known) {
  if (!chat?.chainId || !known.has(String(chat.chainId))) return false;
  if (chat.live || chat.waiting || chat.paused || chat.summoned || chat.resume) return false;
  if (chat.compactAfter || chat.catchingUp || chat.hydrateAfterSend) return false;
  return !(chat.queue?.items?.length);
}

/**
 * The ids of the chats to let go of now: past the `keep` most recently shown, those that hold nothing of their own.
 * @param {Iterable<any>} chats @param {{ current: string | null, known: Set<string>, keep?: number }} o
 * @returns {string[]}
 */
export function chatsToLet(chats, o) {
  const keep = o.keep ?? KEEP_SHOWN;
  const others = [...chats].filter((c) => c && c.id !== o.current);
  others.sort((a, b) => (Number(b.shownAt) || 0) - (Number(a.shownAt) || 0));
  return others.slice(keep).filter((c) => letGoable(c, o.known)).map((c) => String(c.id));
}

/**
 * What a chat let go of takes back when it opens again, by its session: the view it showed and the sub-agent cards
 * opened on it — the page's own, never read from the session.
 * @param {any} chat
 */
export const keptOf = (chat) => ({ viewTab: chat.viewTab || "chat", cardsOpen: chat.cardsOpen ? [...chat.cardsOpen] : [] });

/**
 * A turn heard on the feed for a chat the page keeps but does not show — a background command's end woke it, a resume,
 * another tab's turn (the owner's of 10-29: three such turns were never drawn, the chat shown again as it was left):
 * when it was heard stays on the chat, and showing the chat reads its transcript again. The chat on screen follows its
 * turns as they come, once its first read has landed: one heard while that read is on its way is read after it (app.js
 * `openSession`). The page's own running turn draws itself.
 * @param {any} chat  the page's chat on that session, if it keeps one
 * @param {any} shown  the chat on screen that follows its turns now: none while its first read is on its way
 * @param {number} at
 */
export function noteUnseenTurn(chat, shown, at) {
  if (!chat || chat === shown || chat.live) return;
  chat.unseenAt = Math.max(Number(chat.unseenAt) || 0, at);
}

/**
 * A read of the chat's transcript asked at `asked` has landed: a turn heard before then is in it. One heard the same
 * moment or after it, while the read was on its way, may not be, and is still to be read.
 * @param {any} chat @param {number} asked
 */
export function readSince(chat, asked) {
  if ((Number(chat.unseenAt) || 0) < asked) chat.unseenAt = 0;
}

/** Whether showing the chat reads its transcript again first: a turn ran on it that the page did not draw. @param {any} chat */
export const readsOnShow = (chat) => !!chat?.unseenAt && !chat.live;
