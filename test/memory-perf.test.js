// W3 item 3.1 — collapsing the repeated O(conversation) passes in the memory path.
//
// A CPU profile (node --cpu-prof over scripts/cache-stress.mjs --turns 200 --msg-kb 16) put ~22% of total runtime in
// sha256 `update`, essentially all of it `messageHash` hashing the SAME messages several times per request: once per
// message in reattachBlocks, then a fresh full walk with fresh hashes inside putBlock for EVERY block stored. With k
// blocks on an n-message history that is O(k·n) per request on a conversation the client resends in full every turn.
//
// These tests pin the collapse with counters rather than trusting a comment: `scan.stats` records how many flattens,
// walks and hashes actually happened, so reverting any part of the change moves a number. They also pin the part
// that must NOT change — `nth`, the occurrence counting that decides which duplicate of an identical message gets a
// block. Getting that wrong re-attaches a block to the wrong message and breaks the provider's prompt cache from
// that point on, which is the one thing this project treats as unbreakable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createConversationScan, reattachBlocks, messageHash, isBlockEligibleUser, stripMessageMemoryBlocks, MEMORY_TAG,
} from "../src/memory-brain.js";
import { detectHousekeeping } from "../src/housekeeping.js";
import { Archive } from "../src/archive.js";

// The pre-optimisation hash, transcribed from commit 964af89: it ALWAYS ran stripMemoryBlocks (which ends in .trim())
// over string content and always rebuilt array content. Blocks in existing archives are keyed by THIS value, so the
// optimised path must reproduce it exactly — otherwise every stored block orphans on upgrade, re-attachment silently
// stops, and the provider's cached prefix changes for every affected chain.
const LEGACY_BLOCK_RE = new RegExp(`\\n*<${MEMORY_TAG}\\b[^>]*>[\\s\\S]*?</${MEMORY_TAG}>\\n*`, "g");
const legacyStrip = (text) => String(text ?? "").replace(LEGACY_BLOCK_RE, "\n").trim();
const sha256 = (s, n = 16) => createHash("sha256").update(String(s)).digest("hex").slice(0, n);
const legacyHash = (msg) => {
  if (!msg) return sha256_24("");
  const clone = typeof msg.content === "string" ? { ...msg, content: legacyStrip(msg.content) }
    : Array.isArray(msg.content) ? { ...msg, content: msg.content.flatMap((b) => { if (b && b.type === "text" && typeof b.text === "string" && b.text.includes(`<${MEMORY_TAG}`)) { const t = legacyStrip(b.text); return t ? [{ ...b, text: t }] : []; } return [b]; }) } : msg;
  return sha256_24(JSON.stringify(clone));
};

// A conversation with deliberate duplicates: `nth` only matters when the same text appears more than once.
const DUP = "please fix the flux capacitor";
function convo({ dups = 3, turns = 12, toolLegs = true, format = "anthropic" } = {}) {
  const out = [];
  if (format === "openai") out.push({ role: "system", content: "You are helpful." });
  for (let i = 0; i < turns; i++) {
    // every third turn repeats the same text, so several messages share a hash
    out.push({ role: "user", content: i % 3 === 0 ? DUP : `turn ${i}: something unique about gizmo ${i}` });
    if (toolLegs) {
      if (format === "anthropic") {
        out.push({ role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "Read", input: { file_path: `f${i}.js` } }] });
        out.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "file bytes" }] });
      } else {
        out.push({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: "Read", arguments: "{}" } }] });
        out.push({ role: "tool", content: "file bytes", tool_call_id: `c${i}` });
      }
    }
    out.push({ role: "assistant", content: `answer ${i}` });
  }
  return out;
}
const anth = (messages, system = "You are Claude Code.\nWorking directory: C:\\proj") => ({ format: "anthropic", body: { model: "claude-x", max_tokens: 100, system, messages } });
const oai = (messages) => ({ format: "openai", body: { model: "gpt-x", max_tokens: 100, messages } });

test("scan: one flatten and one hash per message, no matter how many times they are asked for", () => {
  const { format, body } = anth(convo({ turns: 20 }));
  const scan = createConversationScan(format, body);
  const n = body.messages.length;
  // Ask for everything the memory path asks for, several times over.
  scan.systemText(); scan.systemText();
  scan.firstUserText(); scan.userTextCount(); scan.firstUserText();
  assert.equal(scan.stats.flattens, 1, `flattenMessages ran once, not ${scan.stats.flattens} times (it used to run 3x per request)`);
  assert.equal(scan.stats.walks, 1, "one walk for the first user text and the count; the occurrence counts are still lazy");
  // Hashing is lazy until something needs it; then it is exactly one hash per eligible message, memoized.
  assert.equal(scan.stats.hashes, 0, "no hashing happened just to situate the request");
  const counts = scan.nthOf(messageHash(body.messages[0]));
  assert.ok(counts >= 1);
  assert.equal(scan.stats.walks, 2, "asking for an occurrence count built it — and only once");
  assert.ok(scan.stats.hashes > 0, "the occurrence count hashed what it needed");
  const afterFirst = scan.stats.hashes;
  assert.ok(afterFirst <= n, `at most one hash per message (${afterFirst} hashes for ${n} messages)`);
  // THE collapse: asking for more hashes — as putBlock once did per stored block — costs nothing further.
  for (let i = 0; i < n; i++) scan.hashAt(i);
  for (const m of body.messages) scan.nthOf(messageHash(m));
  for (let i = 0; i < n; i++) scan.hashAt(i);
  assert.equal(scan.stats.hashes, n, `repeated lookups are free: still exactly ${n} hashes for ${n} messages (was O(k·n))`);
  // and the memo is stable
  assert.equal(scan.hashAt(0), scan.hashAt(0));
  assert.equal(scan.hashAt(0), messageHash(body.messages[0]), "the memo returns the same hash the direct call does");
});

test("scan: attaching a memory block does not change a message's hash (the memo stays valid)", () => {
  const { format, body } = anth(convo({ turns: 4 }));
  const scan = createConversationScan(format, body);
  const before = body.messages.map((_, i) => scan.hashAt(i));
  // Attach blocks the way prepare does, then re-read every hash from the memo AND freshly.
  for (let i = 0; i < body.messages.length; i++) {
    if (!isBlockEligibleUser(body.messages[i], format)) continue;
    const m = body.messages[i];
    const tag = `<${MEMORY_TAG} kind="turn">\nsome recalled memory ${i}\n</${MEMORY_TAG}>`;
    m.content = typeof m.content === "string" ? `${tag}\n\n${m.content}` : m.content;
  }
  for (let i = 0; i < body.messages.length; i++) {
    assert.equal(scan.hashAt(i), before[i], `index ${i}: the memo did not go stale when a block was attached`);
    // The stronger claim: a freshly computed hash of the MUTATED message still equals the original, because
    // messageHash strips memory blocks first. Without that property the whole memo would be unsound.
    assert.equal(messageHash(body.messages[i]), before[i], `index ${i}: hashing is invariant to our own injection`);
  }
});

test("nth: identical messages are counted exactly as the old per-block full walk counted them", () => {
  for (const format of ["anthropic", "openai"]) {
    const built = format === "anthropic" ? anth(convo({ turns: 9, format })) : oai(convo({ turns: 9, format }));
    const { body } = built;
    const scan = createConversationScan(built.format, body);
    const msgs = body.messages;
    // The old implementation, transcribed: a fresh full walk with a fresh hash per message, per stored block.
    const oldNth = (h) => { let nth = 0; for (let i = 0; i < msgs.length; i++) { const m = msgs[i]; if (!m || m.role !== "user") continue; if (built.format === "anthropic" && Array.isArray(m.content) && m.content.length && m.content.every((b) => b?.type === "tool_result")) continue; if (messageHash(m) === h) nth++; } return Math.max(1, nth); };
    const eligible = msgs.map((m, i) => ({ m, i })).filter(({ m }) => isBlockEligibleUser(m, built.format));
    assert.ok(eligible.length >= 6, "the fixture has enough eligible messages to be meaningful");
    for (const { m, i } of eligible) {
      const h = messageHash(m);
      assert.equal(Math.max(1, scan.nthOf(h)), oldNth(h), `${format} index ${i}: nth agrees with the old walk`);
    }
    // The duplicates really are duplicates, so the count is actually exercised
    const dupHash = messageHash({ role: "user", content: DUP });
    assert.ok(scan.nthOf(dupHash) >= 3, `${format}: the repeated message is counted ${scan.nthOf(dupHash)} times`);
    assert.equal(scan.nthOf("not-a-real-hash"), 0, "an unknown hash counts zero");
  }
});

test("reattachBlocks: an empty block map costs no hashing at all, and a full one attaches to the right duplicate", () => {
  const { format, body } = anth(convo({ turns: 12 }));
  // Nothing stored yet (a fresh chain): the walk is skipped entirely instead of hashing every message to find nothing.
  const fresh = createConversationScan(format, body);
  assert.equal(reattachBlocks(format, body, {}, fresh), 0);
  assert.equal(fresh.stats.hashes, 0, `zero hashes when there is nothing to re-attach (was one per user message)`);
  assert.equal(reattachBlocks(format, body, new Map(), fresh), 0, "and the same for a Map-shaped store");
  assert.equal(fresh.stats.hashes, 0);

  // Now the behaviour that must not change: a block stored for the SECOND occurrence of a duplicated message must
  // attach to the second occurrence only. Getting this wrong re-attaches to the wrong message and the provider's
  // cached prefix changes — the one thing that must never happen.
  const b2 = { ...body, messages: structuredClone(body.messages) };
  const scan2 = createConversationScan(format, b2);
  const dupHash = messageHash({ role: "user", content: DUP });
  const idxs = [];
  for (let i = 0; i < b2.messages.length; i++) if (isBlockEligibleUser(b2.messages[i], format) && messageHash(b2.messages[i]) === dupHash) idxs.push(i);
  assert.ok(idxs.length >= 3, `the duplicate appears ${idxs.length} times`);
  const marker = `<${MEMORY_TAG} kind="turn">\nrecalled for the second occurrence\n</${MEMORY_TAG}>`;
  const hits = (ms) => ms.map((m, i) => (JSON.stringify(m).includes("recalled for the second occurrence") ? i : -1)).filter((i) => i >= 0);
  const n = reattachBlocks(format, b2, { [dupHash]: { text: marker, nth: 2 } }, scan2);
  // The rule is `seen >= nth`, so a stored nth of 2 marks the 2nd AND any later duplicate. That is the existing
  // contract (changing it would move blocks the provider has already cached); what this test pins is that the
  // memoized path reproduces it exactly, message for message.
  assert.ok(idxs.length >= 3, `the duplicate appears ${idxs.length} times`);
  assert.deepEqual(hits(b2.messages), idxs.slice(1), "every occurrence from the 2nd on got the block, and the 1st did not");
  assert.equal(n, idxs.length - 1, "and the count says so");
  assert.ok(!JSON.stringify(b2.messages[idxs[0]]).includes(MEMORY_TAG), "the first occurrence stayed clean, exactly as the client sent it");
  // nth 1 attaches from the first occurrence on
  const b3 = { ...body, messages: structuredClone(body.messages) };
  reattachBlocks(format, b3, { [dupHash]: { text: marker, nth: 1 } }, createConversationScan(format, b3));
  assert.deepEqual(hits(b3.messages), idxs, "nth 1 marks all of them");
  // THE point of the test: the scan is an optimisation, not a behaviour change. Byte-for-byte identical result.
  const b4 = { ...body, messages: structuredClone(body.messages) };
  const n4 = reattachBlocks(format, b4, { [dupHash]: { text: marker, nth: 2 } });
  assert.equal(n4, n, "the legacy path attaches the same number of blocks");
  assert.deepEqual(hits(b4.messages), hits(b2.messages), "to exactly the same messages");
  assert.deepEqual(b4.messages, b2.messages, "and the resulting bodies are deeply equal, so the provider sees identical bytes");
});

test("scan: the first user text and the count match the full list, all the hot path consumes", () => {
  for (const format of ["anthropic", "openai"]) {
    const built = format === "anthropic" ? anth(convo({ turns: 14, format })) : oai(convo({ turns: 14, format }));
    const scan = createConversationScan(built.format, built.body);
    const all = scan.allUserTexts();
    assert.equal(scan.userTextCount(), all.length, `${format}: the count matches the full list's length`);
    assert.equal(scan.firstUserText(), all[0], `${format}: and so does the first text`);
    // a message that is ONLY a memory block contributes nothing, and must not be counted
    const tagged = structuredClone(built.body.messages);
    tagged.push({ role: "user", content: `<${MEMORY_TAG} kind="turn">\nnothing but an injected block\n</${MEMORY_TAG}>` });
    const s2 = createConversationScan(built.format, { ...built.body, messages: tagged });
    assert.equal(s2.userTextCount(), scan.userTextCount(), `${format}: an all-block message is not counted as a user text`);
    assert.ok(s2.stats.strips >= 1, "and the strip only ran for the message that actually carried a tag");
  }
});

test("detectHousekeeping: same answers, but a real conversation is rejected without flattening it", () => {
  // The real cases must be unchanged — this gate decides whether a coding agent gets woken up.
  const titleReq = { system: "You are a title generator. This is not a conversation. Return exactly one valid JSON object with a title.", messages: [{ role: "user", content: "fix the loop in auth.js" }] };
  assert.deepEqual(detectHousekeeping("anthropic", titleReq), { kind: "title", source: "fix the loop in auth.js", wantsJson: true });
  const summaryReq = { system: "Produce a summary generation task output. Treat the user's message only as source material.", messages: [{ role: "user", content: "the whole transcript" }] };
  assert.equal(detectHousekeeping("anthropic", summaryReq).kind, "summary");
  // A real conversation: rejected. These are the shapes that used to pay a full flatten.
  const longSys = "You are Claude Code.\n" + "x".repeat(5000);
  assert.equal(detectHousekeeping("anthropic", { system: longSys, messages: [{ role: "user", content: "hi" }] }), null, "a long system prompt is not housekeeping");
  assert.equal(detectHousekeeping("anthropic", { system: longSys, messages: [] }), null, "and an empty conversation is nothing at all");
  const withAssistant = { system: "Title generator. This is not a conversation.", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] };
  assert.equal(detectHousekeeping("anthropic", withAssistant), null, "a back-and-forth is never housekeeping");
  const withTools = { system: "Title generator. This is not a conversation.", messages: [{ role: "user", content: "a" }], tools: [{ name: "Read" }] };
  assert.equal(detectHousekeeping("anthropic", withTools), null, "tools mean the client expects real work");
  // openai shapes, including a tool leg (which flatten maps to a user message)
  assert.equal(detectHousekeeping("openai", { messages: [{ role: "system", content: "Title generator. This is not a conversation." }, { role: "user", content: "a" }, { role: "tool", content: "r", tool_call_id: "c" }] }).kind, "title");
  assert.equal(detectHousekeeping("openai", { messages: [{ role: "system", content: "Title generator. This is not a conversation." }, { role: "assistant", content: "b" }] }), null);
  assert.equal(detectHousekeeping("openai", { messages: [{ role: "developer", content: "x".repeat(5000) }, { role: "user", content: "a" }] }), null, "a long developer message is not housekeeping either");
  // A system prompt made of blocks is measured, not missed
  assert.equal(detectHousekeeping("anthropic", { system: [{ type: "text", text: "Title generator. This is not a conversation." }], messages: [{ role: "user", content: "q" }] }).kind, "title");
  assert.equal(detectHousekeeping("anthropic", { system: [{ type: "text", text: "x".repeat(5000) }], messages: [{ role: "user", content: "q" }] }), null, "and a long block system prompt is still rejected");
  // Boundary: the cap is 4000 characters of system text. Just under still counts as housekeeping; just over does not.
  const head = "Title generator. This is not a conversation. ";
  const under = { system: head + "y".repeat(4000 - head.length - 10), messages: [{ role: "user", content: "q" }] };
  assert.ok(under.system.length <= 4000, `the fixture really is under the cap (${under.system.length})`);
  assert.equal(detectHousekeeping("anthropic", under).kind, "title", "just under the cap is still housekeeping");
  const over = { system: head + "y".repeat(4200), messages: [{ role: "user", content: "q" }] };
  assert.ok(over.system.length > 4000, `and this one really is over (${over.system.length})`);
  assert.equal(detectHousekeeping("anthropic", over), null, "just over the cap is rejected, as before");
});

test("searchInputs: excluding the current chain happens in SQL, so other sessions still come back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-perf-arch-"));
  try {
    const a = new Archive({ file: join(dir, "archive.db") });
    const mine = a.chainForKey("k-mine", { project: null, cwd: null, client: "test", model: "m" });
    const other = a.chainForKey("k-other", { project: null, cwd: null, client: "test", model: "m" });
    // The same distinctive phrase in both chains: without the SQL exclusion, the current chain crowds out the other.
    for (const [ch, tag] of [[mine, "mine"], [other, "other"]]) {
      for (let i = 0; i < 6; i++) {
        const t = a.beginTurn(ch.id, { userMessage: { role: "user", content: `zymox calibration widget ${tag} ${i}` } });
        a.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: `done ${tag} ${i}` } });
      }
    }
    const unfiltered = a.searchInputs("zymox calibration widget", { limit: 6 });
    assert.ok(unfiltered.length > 0, "the phrase is findable");
    const filtered = a.searchInputs("zymox calibration widget", { limit: 6, notChainId: mine.id });
    assert.ok(filtered.length > 0, "and still findable when this chain is excluded");
    assert.ok(filtered.every((r) => r.chainId !== mine.id), "no row from the excluded chain");
    assert.ok(filtered.some((r) => r.chainId === other.id), "the OTHER session comes back — which is the point");
    // The old behaviour fetched 6 rows and threw away the ones from this chain; with 6 turns in each, that used to
    // be able to return nothing useful at all.
    assert.ok(unfiltered.filter((r) => r.chainId === mine.id).length > 0, "unfiltered does include this chain, so the exclusion is doing real work");
    assert.deepEqual(a.searchInputs("", { notChainId: mine.id }), [], "an empty query is still empty");
    // A query with nothing FTS5 can match falls back to the substring scan instead of throwing.
    let fallback = null;
    assert.doesNotThrow(() => { fallback = a.searchInputs("!!! ???", { notChainId: mine.id }); }, "an unsearchable query does not throw");
    assert.ok(Array.isArray(fallback), "and returns an array");
    assert.ok(fallback.every((r) => r.chainId !== mine.id), "with the exclusion still applied on the fallback path");
    a.close();
  } finally { for (let i = 0; i < 12; i++) { try { rmSync(dir, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 150)); } } }
});

test("messageHash is UNCHANGED by the fast path — blocks stored by an older version still match", () => {
  // THE P1 THIS PINS. Blocks are persisted keyed by this hash (`archive.setBlock` / `blocksFor`), so changing the
  // hash function orphans every stored block on upgrade: reattachBlocks computes new-style hashes, finds nothing, and
  // the memory a provider already saw silently disappears from the history — one full cache invalidation per chain.
  // `legacyHash` is the pre-optimisation implementation transcribed verbatim (it ALWAYS called stripMemoryBlocks,
  // which ends in .trim()); the fast path must agree with it on every shape, including boundary whitespace.
  const legacyHash = (msg) => {
    // Note the deliberate quirk being reproduced: a null message hashes with `sha("")`'s DEFAULT 16 characters while
    // every other path asks for 24. Harmless (different lengths cannot collide) but it must be preserved, because
    // changing it would orphan stored blocks exactly like changing the trim behaviour would.
    if (!msg) return sha256("");
    const clone = typeof msg.content === "string" ? { ...msg, content: legacyStrip(msg.content) }
      : Array.isArray(msg.content) ? { ...msg, content: msg.content.flatMap((b) => { if (b && b.type === "text" && typeof b.text === "string" && b.text.includes(`<${MEMORY_TAG}`)) { const t = legacyStrip(b.text); return t ? [{ ...b, text: t }] : []; } return [b]; }) } : msg;
    return sha256(JSON.stringify(clone), 24);
  };
  const tag = (kind, t) => `<${MEMORY_TAG} kind="${kind}">\n${t}\n</${MEMORY_TAG}>`;
  const shapes = [
    { role: "user", content: "plain" },
    { role: "user", content: "padded trailing newline\n" },          // the exact case that broke
    { role: "user", content: "\n\npadded leading" },
    { role: "user", content: "  padded both sides  " },
    { role: "user", content: "\t tab and newline \r\n" },
    { role: "user", content: "\u00a0nbsp padded\u00a0" },             // trim() removes nbsp; a charCode>32 test would not
    { role: "user", content: "" },
    { role: "user", content: `${tag("turn", "injected")}\n\nthe real text` },
    { role: "user", content: `the real text\n\n${tag("turn", "injected")}` },
    { role: "user", content: `  ${tag("turn", "x")}\nreal\n  ` },     // tagged AND padded: both paths must agree
    { role: "user", content: `${tag("turn", "only a block")}` },      // strips to nothing
    { role: "user", content: [{ type: "text", text: "block text" }] },
    { role: "user", content: [{ type: "text", text: "padded block\n" }] },
    { role: "user", content: [{ type: "text", text: `${tag("turn", "i")}\nreal` }, { type: "text", text: "second" }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "r" }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "r" }, { type: "text", text: "and more" }] },
    { role: "user", content: [{ type: "image", source: { data: "AAA" } }] },
    { role: "assistant", content: [{ type: "tool_use", id: "x", name: "Read", input: { a: 1 } }] },
    { role: "user", tool_calls: [{ id: "c", function: { name: "f", arguments: "{}" } }] },
    { role: "user" },                                                 // no content at all
    { role: "user", content: null },
    { role: "user", content: 42 },                                    // a non-string, non-array content
  ];
  for (const m of shapes) {
    assert.equal(messageHash(m), legacyHash(m), `hash continuity broken for ${JSON.stringify(m).slice(0, 110)}`);
  }
  assert.equal(messageHash(null), legacyHash(null), "and for a null message");
  // The identity fast path must still be taken where it is safe, or the optimisation is gone
  const clean = { role: "user", content: "no padding, no tag" };
  assert.equal(stripMessageMemoryBlocks(clean), clean, "a clean string message is returned by identity");
  const cleanBlocks = { role: "user", content: [{ type: "text", text: "normal" }] };
  assert.equal(stripMessageMemoryBlocks(cleanBlocks), cleanBlocks, "and so is clean block content");
  const padded = { role: "user", content: "padded\n" };
  assert.notEqual(stripMessageMemoryBlocks(padded), padded, "but a padded one takes the slow path, so its hash still trims");
  assert.equal(stripMessageMemoryBlocks(padded).content, "padded");
});

test("the memo and a live hash agree AFTER a block is attached, for every content shape", () => {
  // Finding 2: `pendingLoad` used to hash the message live, after other branches had attached blocks to it. With a
  // hash function that trimmed, live and memo agreed; the broken fast path made them diverge, so the load block was
  // stored under a key reattachBlocks would never look up again.
  const tag = `<${MEMORY_TAG} kind="turn">\ninjected memory\n</${MEMORY_TAG}>`;
  const shapes = [
    { role: "user", content: "clean text" },
    { role: "user", content: "padded text\n\n" },
    { role: "user", content: "\t padded with tab" },
    { role: "user", content: [{ type: "text", text: "block text" }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "r" }, { type: "text", text: "mixed" }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "r" }] },
  ];
  for (const original of shapes) {
    const messages = [structuredClone(original)];
    const body = { model: "m", max_tokens: 10, messages };
    const scan = createConversationScan("anthropic", body);
    const memo = scan.hashAt(0);
    // attach a block the way applyUserBlock does, for both content shapes
    const m = messages[0];
    if (typeof m.content === "string") m.content = `${tag}\n\n${m.content}`;
    else if (Array.isArray(m.content)) m.content = [...m.content, { type: "text", text: tag }];
    else m.content = tag;
    assert.equal(scan.hashAt(0), memo, `the memo is stable after attachment: ${JSON.stringify(original).slice(0, 80)}`);
    assert.equal(messageHash(messages[0]), memo, `and a LIVE hash still equals the memo — this is what makes storing under either key safe: ${JSON.stringify(original).slice(0, 80)}`);
    assert.equal(scan.nthOf(memo) >= 0, true);
  }
});

test("detectHousekeeping: a near-cap prompt padded with whitespace is still detected, and empty messages are not a new refusal", () => {
  const head = "Title generator. This is not a conversation. Return exactly one valid JSON object.";
  // Finding 3: the floor used to count RAW lengths, so trailing newlines pushed a genuinely-short prompt over the cap
  // and the request was waved through to a coding agent — the failure this module exists to prevent.
  const padded = { system: head + "z".repeat(3900) + "\n".repeat(40), messages: [{ role: "user", content: "fix the loop" }] };
  const realLength = padded.system.trim().length;
  assert.ok(realLength <= 4000, `the trimmed system prompt is under the cap (${realLength})`);
  assert.ok(padded.system.length > 4000, `while the raw one is over it (${padded.system.length}) — this is the case that broke`);
  assert.equal(detectHousekeeping("anthropic", padded).kind, "title", "still detected as housekeeping");
  // the same with leading whitespace, tabs and nbsp
  for (const pad of ["\n".repeat(40), "\t".repeat(40), "\u00a0".repeat(40), " ".repeat(40)]) {
    const p = { system: pad + head + "z".repeat(3900), messages: [{ role: "user", content: "q" }] };
    if (p.system.trim().length <= 4000) assert.equal(detectHousekeeping("anthropic", p).kind, "title", `detected with ${JSON.stringify(pad[0])} padding`);
  }
  // openai, several system messages, padded
  const multi = { messages: [{ role: "system", content: head + "\n\n" }, { role: "developer", content: "z".repeat(3800) + "\n".repeat(60) }, { role: "user", content: "q" }] };
  assert.equal(detectHousekeeping("openai", multi).kind, "title", "openai multiple system messages, padded");
  // Finding 4: an empty message list with a housekeeping prompt used to be answered locally; refusing it early would
  // hand a title prompt to an agent.
  const noMsgs = { system: "Title generator. This is not a conversation.", messages: [] };
  assert.equal(detectHousekeeping("anthropic", noMsgs).kind, "title", "an empty message list is still detected, not waved through");
  assert.deepEqual(detectHousekeeping("anthropic", { system: "Title generator. This is not a conversation." }), { kind: "title", source: "", wantsJson: false }, "and a missing messages array too");
  // genuinely over the cap is still rejected
  assert.equal(detectHousekeeping("anthropic", { system: head + "z".repeat(5000), messages: [{ role: "user", content: "q" }] }), null);
});
