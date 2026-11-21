// @ts-check
// The settings document's fields the session view holds — a module of its own (Step 6 §2.2) because the seam
// between the server's answer and the view is where figures go missing: the answer carried the spend ledger for
// weeks while this whitelist silently dropped it, and the widgets read zeros the tests never saw (their fixtures
// inject the view directly). Pure on purpose, so the whitelist itself is pinned by a test.

/**
 * @param {any} doc
 * @returns {any}
 */
export const viewSettingsOf = (doc) => ({
  effective: doc.effective || null,
  flat: doc.flat || null,
  sources: doc.sources || null,
  window: doc.window || null,
  engine: doc.engine || null,
  hash: doc.hash || null,
  // Whether Filament runs this session's history (a harness task) or its own client does (another client's chat opened here):
  // the Compaction widget draws the client's side from it (HarnessV3-Compaction §7.3). Null when the answer does not say.
  native: typeof doc.native === "boolean" ? doc.native : null,
  // The spend ledger (Step 6 §2.2 Spend/Cache) and the dependency derivations (§1.4) — the widgets read both;
  // dropping them here would leave the pills at zeros while the server holds the figures.
  usage: doc.usage || null,
  // The model's price card (USD per million tokens): Spend splits the dollars by it, Cache says what a read costs.
  price: doc.price || null,
  // The chat's prompt-cache lifetime and whether it can choose one: the Cache widget's 5 min / 1 hour.
  cache: doc.cache || null,
  derived: Array.isArray(doc.derived) ? doc.derived : [],
  // The rules in force (HarnessV3-AtHome AH-D7): the permission switch lists them, each with its Forget.
  rulesInForce: Array.isArray(doc.rulesInForce) ? doc.rulesInForce : [],
  ...(doc.knobs ? { knobs: doc.knobs } : {}),
});

/**
 * Whether the view holds the settings document itself, not only its hash: a running turn's mark gives the hash before the
 * page has read the document, and what the chat sets is not known until it has. Read as "nothing set", the Agents tab's
 * Models for agents named the main agent's model, and a new thread's note said it ran on it, for those seconds (10-24).
 * @param {any} settings  the session view's `settings`
 * @returns {settings is { flat: Record<string, any>, effective: any }}
 */
export const settingsRead = (settings) => !!settings?.flat && !!settings?.effective;
