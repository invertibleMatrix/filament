// @ts-check
// Chats from other coding agents become archive chains, and an existing Mnemosyne database seeds the engine
// (docs/memory-architecture.md §3, §5, §9; the plan: HarnessV4_Import_Plan in the vault). A file per source under
// import/; this is what the rest of Filament imports.
//
// Every importer reports progress through onProgress({ step, message, percent, done, total }) — counts, ids and file
// names only, never message text — and returns { chains, turns, messages, skipped, errors } plus per-source extras.
// Running one again is safe: chains are found by key, turns already in a chain are matched by position and the
// message's words, work by message hash, compactions by summary hash. Secrets are redacted before every write (core/redact.js),
// as for live captures. A chat's own times land in started_at / last_at / ended_at.
export { Sink, readLines } from "./import/sink.js";
export * from "./import/claude-code.js";
export * from "./import/codex.js";
export * from "./import/cursor.js";
export * from "./import/mnemosyne.js";
export * from "./import/sources.js";
