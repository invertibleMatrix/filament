// @ts-check
// Shared type names for the core layer. JSDoc only: this module has no runtime exports beyond the empty
// object that lets `import "./types.js"` resolve, and nothing here may reach for I/O, the clock or config.

/**
 * The shape a request or reply is written in on the wire. "responses" is OpenAI's Responses API, which Filament
 * converts to and from Chat Completions at the edges.
 * @typedef {"anthropic" | "openai" | "responses"} WireFormat
 */

/**
 * A change to a file as a permission card shows it (HarnessV3-ACP, AC3's drive D5): `file` — its path inside the
 * session's folder, else whole —, `patch`, a unified diff of what the call does to it ("" where it says nothing of
 * that), its line counts, whether it makes the file (`created`), removes it (`deleted`) or replaces every occurrence
 * of a text (`every`), and how many of the patch's lines the card leaves out (`omitted`).
 * @typedef {{ file: string, patch: string, added: number, removed: number, created: boolean, deleted: boolean,
 *   every: boolean, omitted: number }} FileChange
 */

/**
 * @typedef {object} RoundChange  one writing round of a turn in one place, for one agent (HarnessV4_Git_Plan step 1)
 * @property {string} place  the top folder of the repository or worktree, as git spells it; "" for files outside any
 * @property {number | null} round
 * @property {string} agent  "" for the turn's own agent; a helper's id for one that wrote in a folder it shares
 * @property {string | null} before  the place's snapshot before the round (null: outside any repository, or no commit)
 * @property {string | null} after  the place's snapshot after it (null: outside any repository)
 * @property {"round" | "last" | "head" | "none" | "move" | "apply"} base  what `before` is: taken just before the round's hands
 *   ran, the place's previous snapshot, its last commit (no snapshot of it was taken before), or nothing (outside any
 *   repository); "move": no round of the hands — the chat's move carried its files out of the place or into it
 *   (HarnessV4_Git_Plan GW-D88), a turn's own changes leave it out; "apply": no round either — a sub-agent's work
 *   came in by an Apply, the files it wrote under its name until committed (10-29), with no snapshot
 * @property {string[]} own  what the agent's own write and edit calls named there: relative to the place, or absolute
 *   outside any repository
 * @property {boolean} command  a command of its ran in the round: what else changed then may be its, or anyone's
 * @property {number} [turn]  the chain's turn number, where several turns' rounds are read
 */

export {};
