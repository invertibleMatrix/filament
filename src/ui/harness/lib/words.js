// @ts-check
// The page's shared words (proposal_ux §8 phase 9, N1): the names of the things and the acts that several parts of the
// page say. A conversation is a chat everywhere — "task" stays the task graph's, and the Space's board's — so New chat,
// Find in chat, Previous and Next chat, Copy chat path, Past chats and the command center's Chats are named here once —
// and the two lists of seats (N2): a seat is a model agents run on, and how many at once —
// and every page that names one reads it from here (test/words.test.js holds the pages to it). A page's sentences stay
// its own until a second language comes (zh-CN, parked: Settings › Appearance › Language then reads this table).

/** The shared names, as the page shows them. */
export const WORDS = Object.freeze({
  /** The left bar's first button, its rail's, the command center's action and an empty chat's title. */
  newChat: "New chat",
  /** The left bar's search (Ctrl+K): the command center. */
  search: "Search",
  /** The command center's list of chats, and the left bar's heading when it groups them. */
  chats: "Chats",
  /** Ctrl+F: the find bar over the chat shown. */
  findInChat: "Find in chat",
  /** The command center's way to the chat above or below in the left bar. */
  previousChat: "Previous chat",
  nextChat: "Next chat",
  /** The title's menu: the chat's address. */
  copyChatPath: "Copy chat path",
  /** The box's `#`: a past chat brought in as material. */
  pastChats: "Past chats",
  /**
   * A chat's list in force, by a name of its own (the owner's 10-25: Library's box's name over a chat's list read as one
   * box showing different models): the Agents tab's seat.
   */
  chatSeats: "Agents run on",
  /** Its editor's head. */
  chatSeatsEditor: "What this chat's agents run on",
});

/** A name's possessive as English writes it: Northwind's, recipes' (the Designer's walk of 10-29). @param {string} name */
export const whose = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
