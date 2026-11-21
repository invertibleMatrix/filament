// @ts-check
// Letters between chats (the owner's of 11-04: "agents should be able to send a message to other threads … in form of
// an envelope so that agent decides to open that whenever it wants and main agent should be able to reply back to that
// envelope letter if reply is requested"): the rules (app/letters.js) — whom a chat writes, a letter's reply, the most
// a chat writes while its person says nothing —, the registry's delivery (subagents.js `letter`) — sealed into a running
// turn, or sealed at once and the chat woken —, and two chats in a running Filament: one asks, the other is woken, opens
// the letter and answers, and the first is woken with the reply. Inside a chat (the owner's of 11-04: "main agent and
// sub agent can talk to each other"): a sub-agent writes the agent that launched it, which answers into its run, and
// that agent writes it back.
// (fails before: yes — the owner's of 11-04: no agent could write into another chat; letters are new)
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LETTERS_ALONE, LETTER_CHARS, chatsTagged, createLetters } from "../src/app/letters.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { chatNamed, writesLetter } from "../src/app/agent/envelopes.js";
import { createAgentRun } from "../src/app/agent-run.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { runRoutes } from "../src/http/admin/runs.js";
import { createRouter } from "../src/http/router.js";
import { envelopeLineOf } from "../src/ui/harness/conversation/envelope-line.js";
import { ENVELOPE_MAIN_TOOL, ENVELOPE_TOOL, argSummary, toolSetFor } from "../src/app/agent/tools.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { TOOL_TEXT } from "../src/app/agent/prompt.js";
import { LETTER_WAKE_LINE, isWakeMessage } from "../src/app/sessions/wake.js";
import { alignEvents, envelopeOpenedWords, envelopeWords, STEER_FROM_WORDS } from "../src/ui/harness/lib/labels.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { LETTER_WAKE_HEAD, transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { wokeRow } from "../src/ui/harness/conversation/turn.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { MemoryService } from "../src/services/memory/index.js";
import { sidecar } from "../src/adapters/sidecar/index.js";
import { createSessions } from "../src/app/sessions/service.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/**
 * Memory's archive as letters reads it: the chats by their titles — or a row as the archive has it, an untitled chat's
 * first words its `preview` — each one's meta, and how many turns each has had (`unstarted`: none).
 * @param {Record<string, string | { title: string | null, preview: string }>} chats @param {string[]} [unstarted]
 */
function archiveOf(chats, unstarted = []) {
  /** @type {Map<string, any>} */
  const meta = new Map();
  return {
    meta,
    getChain: (/** @type {string} */ id) => (id in chats ? (typeof chats[id] === "string" ? { title: chats[id] } : chats[id]) : null),
    newestTurnN: (/** @type {string} */ id) => (unstarted.includes(id) ? 0 : 2),
    metaOf: (/** @type {string} */ id, /** @type {string[]} */ keys) => (id in chats ? Object.fromEntries(keys.filter((k) => meta.get(id)?.[k] !== undefined).map((k) => [k, structuredClone(meta.get(id)[k])])) : null),
    updateMeta: (/** @type {string} */ id, /** @type {(m: any) => void} */ fn) => {
      const m = structuredClone(meta.get(id) || {});
      fn(m);
      meta.set(id, m);
      return m;
    },
  };
}
/** Letters on a stand-in archive and registry: what the registry was handed, in order. */
function lettersOn(/** @type {Parameters<typeof archiveOf>[0]} */ chats, /** @type {"turn" | "sealed" | "queue"} */ at = "sealed", /** @type {string[]} */ unstarted = []) {
  const archive = archiveOf(chats, unstarted);
  /** @type {{ to: string, d: any }[]} */
  const handed = [];
  let n = 0;
  const letters = createLetters({
    archive: () => archive,
    registry: () => ({ letter: (/** @type {string} */ to, /** @type {any} */ d) => (handed.push({ to, d }), { ok: true, at }) }),
    newId: () => `lt_${String(++n).padStart(8, "0")}`,
  });
  return { letters, archive, handed };
}
const CHATS = { a: "Cheap model", b: "Good model", c: "Elsewhere" };
const tag = (/** @type {string} */ id, /** @type {string} */ title) => `[${title}](chat:${id})`;
/** A letter as letters.js hands it to the registry. */
const LETTER = { text: "Please confirm: is 7 prime?", from: "a", description: "Cheap model", sender: 'the chat "Cheap model" (a)', subject: "Is 7 prime?" };

describe("whom a chat writes, and its letters' words", () => {
  test("the envelope tool writes and answers letters, and its words say how", () => {
    const props = /** @type {any} */ (ENVELOPE_TOOL.input_schema.properties);
    assert.deepEqual([props.to.type, props.subject.type, props.text.type, props.reply.type, props.answer.type], ["string", "string", "string", "boolean", "string"]);
    // Version 101 (the owner's of 11-09) added dismiss's sentence after the letters'.
    assert.ok(TOOL_TEXT.envelope.endsWith("one that asks for a reply gives its id in its last line, for answer. dismiss takes lines of what Filament says is still open that no longer hold, by their ids."), TOOL_TEXT.envelope);
    assert.match(props.answer.description, /^Reply to a letter that asked for one, by the id its last line gives \(lt_…\), with text\.$/, "answer, that id, and text send the reply");
    assert.deepEqual([argSummary("envelope", { to: "b", subject: "Is 7 prime?" }), argSummary("envelope", { answer: "lt_1", text: "yes" }), argSummary("envelope", { all: true })], ["letter to b: Is 7 prime?", "answer lt_1", "all"]);
  });

  test("a chat's tag, its id or chat:<id> names it; a person's message tags each chat once; the tool's call writes or answers a letter, else it opens", () => {
    assert.deepEqual([chatNamed("b"), chatNamed("chat:b"), chatNamed(tag("b", "Good model")), chatNamed("no such id!"), chatNamed("")], ["b", "b", "b", "", ""]);
    assert.deepEqual(chatsTagged(`ask ${tag("b", "Good model")} and ${tag("c", "x")}, then ${tag("b", "again")}`), ["b", "c"]);
    assert.deepEqual([writesLetter({ to: "b" }), writesLetter({ answer: "lt_1" }), writesLetter({ count: 2 }), writesLetter({ to: " " }), writesLetter(null)], [true, true, false, false, false]);
  });

  test("only to a chat its person tagged in it, or one that wrote to it; never itself, nor a chat that is not there", () => {
    const { letters, handed } = lettersOn(CHATS);
    const ask = { to: "b", subject: "Is 7 prime?", text: "Please confirm: is 7 prime?" };
    assert.match(letters.send("a", ask).text, /^Not sent: you write only to a chat the developer tagged in this chat, one that wrote to you, the chat your watcher may guide while it is switched on, or a thread linked to it, and the chat "Good model" \(b\) is none of them\. Ask the developer to tag it here with @\.$/);
    letters.heard("a", `ask ${tag("b", "Good model")} whether 7 is prime`);
    const sent = letters.send("a", ask);
    assert.equal(sent.ok, true, sent.text);
    assert.equal(sent.text, 'Sent: letter lt_00000001 to the chat "Good model" (b). Its agent was at rest: Filament wakes it, and it opens the letter when it chooses.');
    assert.deepEqual(handed.map((x) => [x.to, x.d.from, x.d.sender, x.d.subject, x.d.description]), [["b", "a", 'the chat "Cheap model" (a)', "Is 7 prime?", "Cheap model"]]);
    assert.match(handed[0].d.text, /^Please confirm: is 7 prime\?\n\n\[Filament: letter lt_00000001, from the chat "Cheap model" \(a\)\. It asks for no reply\.\]$/);
    // The chat it wrote may write back without a tag; a third chat may not.
    assert.equal(letters.send("b", { to: "a", subject: "Also", text: "One more thing." }).ok, true);
    assert.equal(letters.send("c", { to: "a", subject: "Hi", text: "Hello." }).ok, false);
    assert.equal(letters.send("a", { ...ask, to: "a" }).text, "Not sent: that is this chat.");
    assert.equal(letters.send("a", { ...ask, to: "zz" }).text, "Not sent: there is no chat zz.");
    assert.match(letters.send("a", { ...ask, to: "" }).text, /^Not sent: `to` names no chat\./);
  });

  test("a subject and words are needed; a letter past LETTER_CHARS is refused; its subject is its first line", () => {
    const { letters, handed } = lettersOn(CHATS);
    letters.heard("a", tag("b", "Good model"));
    assert.equal(letters.send("a", { to: "b", subject: " ", text: "x" }).text, "Not sent: a letter needs a subject, in one line.");
    assert.equal(letters.send("a", { to: "b", subject: "s", text: "" }).text, "Not sent: the letter has no text.");
    assert.match(letters.send("a", { to: "b", subject: "s", text: "x".repeat(LETTER_CHARS + 1) }).text, /^Not sent: the letter is 20,001 characters, past the 20,000 a letter holds\./);
    assert.equal(letters.send("a", { to: "b", subject: "First line\nsecond", text: "x" }).ok, true);
    assert.equal(handed[0].d.subject, "First line");
  });

  // (fails before: yes — the review of 11-04: a chat whose results go whole because its envelopes are off was said to
  // have an agent that "opens no envelopes", and a letter to a running turn was said to be found sealed, which its agent
  // decides)
  test("a chat at rest that takes letters whole, and one at work, are said as they go", () => {
    for (const [at, words] of [
      ["queue", "Its agent was at rest, and its chat takes letters whole: Filament wakes it with the letter."],
      ["turn", "Its agent is at work: the letter reaches it at its next step."],
    ]) {
      const { letters } = lettersOn(CHATS, /** @type {"turn" | "queue"} */ (at));
      letters.heard("a", tag("b", "Good model"));
      assert.equal(letters.send("a", { to: "b", subject: "Hi", text: "?" }).text, `Sent: letter lt_00000001 to the chat "Good model" (b). ${words}`);
    }
  });

  // (fails before: yes — the bug hunt of 11-04 on l-read and l-tool: a tag inside pasted code let the agent write to
  // that chat; an untitled chat was "untitled" where the left bar names it by its first words, the tag in them raw; a
  // reply asked as the string "true" asked none; a chat that never had a turn was said to be woken, which nothing does)
  test("a tag in pasted code is no tag; an untitled chat goes by its first words; reply as words; a chat with no turn yet is said so", () => {
    const { letters, handed } = lettersOn({ a: { title: null, preview: `ask  ${tag("b", "Good \\] model")}\nwhether 7 is prime, and also a great deal more besides that runs long` }, b: "Good model", c: "Elsewhere", n: "New chat" }, "sealed", ["n"]);
    letters.heard("a", `look:\n\`\`\`\nsee ${tag("c", "Elsewhere")}\n\`\`\`\nand \`${tag("c", "Elsewhere")}\``);
    assert.equal(letters.send("a", { to: "c", subject: "Hi", text: "?" }).ok, false, "only code tagged it");
    letters.heard("a", `${tag("b", "Good model")} and ${tag("n", "New chat")}`);
    const sent = letters.send("a", { to: "b", subject: "Is 7 prime?", text: "?", reply: "true" });
    assert.equal(sent.ok, true, sent.text);
    assert.match(sent.text, /You asked for a reply/);
    assert.equal(handed[0].d.sender, 'the chat "ask Good ] model whether 7 is prime, and also a great deal …" (a)');
    assert.equal(handed[0].d.description, "ask Good ] model whether 7 is prime, and also a great deal …");
    assert.equal(letters.send("a", { to: "n", subject: "Hello", text: "?" }).text, 'Sent: letter lt_00000002 to the chat "New chat" (n). That chat has had no turn yet: nothing wakes it, and its agent finds the letter once its person first writes there.');
  });

  test("a letter that asks a reply says how in its last line; the answer goes back as a letter, once, and asks none", () => {
    const { letters, handed } = lettersOn(CHATS, "turn");
    letters.heard("a", tag("b", "Good model"));
    const sent = letters.send("a", { to: "b", subject: "Is 7 prime?", text: "Please confirm.", reply: true });
    assert.match(sent.text, /You asked for a reply: it comes to you as a letter, sealed like an envelope, and may take a while\. Carry on meanwhile; with nothing else to do, end your turn — Filament wakes you with it\.$/);
    // Whether that turn's agent seals it is its own (EN-D10): the sender is told no more than when it arrives.
    assert.match(sent.text, /Its agent is at work: the letter reaches it at its next step\./);
    assert.match(handed[0].d.text, /\[Filament: letter lt_00000001, from the chat "Cheap model" \(a\)\. It asks for a reply: once you have one, send it with Filament's envelope tool — answer: "lt_00000001", text: your reply\. Your reply goes back to that chat as a letter\.\]$/);
    assert.match(letters.send("c", { answer: "lt_00000001", text: "yes" }).text, /^Not sent: no letter lt_00000001 waits for your reply\./, "another chat cannot answer it");
    const answered = letters.send("b", { answer: "lt_00000001", text: "Yes, 7 is prime." });
    assert.equal(answered.text, 'Sent: your reply to letter lt_00000001, to the chat "Cheap model" (a). Its agent is at work: the letter reaches it at its next step.');
    assert.deepEqual([handed[1].to, handed[1].d.subject], ["a", "Re: Is 7 prime?"]);
    assert.equal(handed[1].d.text, 'Yes, 7 is prime.\n\n[Filament: the reply to your letter lt_00000001 ("Is 7 prime?"), from the chat "Good model" (b).]');
    assert.equal(letters.send("b", { answer: "lt_00000001", text: "again" }).ok, false, "answered once");
    assert.equal(letters.send("b", { answer: "lt_00000001", text: "" }).ok, false);
  });

  test(`a chat sends at most ${LETTERS_ALONE} letters while its person says nothing in it; their next message counts from none; replies are not counted`, () => {
    const { letters } = lettersOn(CHATS);
    letters.heard("a", tag("b", "Good model"));
    for (let i = 0; i < LETTERS_ALONE; i++) assert.equal(letters.send("a", { to: "b", subject: `q${i}`, text: "?", reply: true }).ok, true);
    assert.match(letters.send("a", { to: "b", subject: "one more", text: "?" }).text, new RegExp(`^Not sent: this chat has sent ${LETTERS_ALONE} letters since the developer last wrote in it`));
    // The chat that answers them is not stopped by its replies.
    for (let i = 1; i <= LETTERS_ALONE; i++) assert.equal(letters.send("b", { answer: `lt_${String(i).padStart(8, "0")}`, text: "!" }).ok, true);
    letters.heard("a", "go on");
    assert.equal(letters.send("a", { to: "b", subject: "again", text: "?" }).ok, true, "the person wrote: it counts from none, and the tag stays");
  });
});

// (fails before: yes — the owner's of 11-04, "main agent and sub agent can talk to each other based on the problem and
// scenario": a sub-agent had no envelope tool, its "lead" read as a chat that is not there, and the main agent's letter
// to a sub-agent's id was refused as no chat)
describe("inside a chat: its agent and its sub-agents write each other", () => {
  /** @type {Record<string, any>} */
  const AGENTS = {
    sa_00000001: { id: "sa_00000001", chainId: "a", status: "running", description: "Audit", team: null },
    sa_00000002: { id: "sa_00000002", chainId: "a", status: "done", description: "Old", team: null },
    sa_00000003: { id: "sa_00000003", chainId: "b", status: "running", description: "Theirs", team: null },
    sa_00000004: { id: "sa_00000004", chainId: "a", status: "running", description: "Build it", team: { role: "builder" } },
  };
  /** Why letters do not go with a sub-agent, as the registry says it (`letterBar`); none by default. @type {Record<string, string>} */
  const BAR = {};
  /** Letters on a stand-in archive and registry: the letters handed to a chat's agent, and the words steered into a sub-agent's run. */
  const inChat = (/** @type {"turn" | "sealed" | "queue"} */ at = "turn") => {
    const archive = archiveOf(CHATS);
    /** @type {{ to: string, d: any }[]} */
    const handed = [];
    /** @type {{ id: string, chainId: string, text: string, from: string }[]} */
    const told = [];
    let n = 0;
    const letters = createLetters({
      archive: () => archive,
      registry: () => ({
        letter: (/** @type {string} */ to, /** @type {any} */ d) => (handed.push({ to, d }), { ok: true, at }),
        get: (/** @type {string} */ id) => AGENTS[id] ?? null,
        letterBar: (/** @type {string} */ id) => BAR[id] ?? "",
        message: (/** @type {string} */ id, /** @type {any} */ m) => (AGENTS[id]?.status === "running" ? (told.push({ id, ...m }), { ok: true, asking: null }) : { ok: false, error: `sub-agent ${id} is not running` }),
      }),
      newId: () => `lt_${String(++n).padStart(8, "0")}`,
    });
    return { letters, handed, told };
  };
  const SA = { agent: "sa_00000001" };

  test("a sub-agent writes the agent that launched it, sealed as a letter; that agent's reply reaches its run whole; once, and the addressee's alone", () => {
    const { letters, handed, told } = inChat();
    const sent = letters.send("a", { to: "lead", subject: "Which file?", text: "Is it a.js or b.js?", reply: true }, SA);
    assert.equal(sent.text, "Sent: letter lt_00000001 to the main agent. It is at work: the letter reaches it at its next step, and it opens it when it chooses. You asked for a reply: it reaches you whole at your next step, and may take a while. Carry on meanwhile — a reply that comes once you have reported reaches you no more.");
    assert.deepEqual(sent.sent, { id: "lt_00000001", to: "lead", title: "the main agent", subject: "Which file?", reply: true });
    assert.deepEqual(handed.map((x) => [x.to, x.d.via, x.d.from, x.d.sender, x.d.description, x.d.subject]), [["a", "agent", "sa_00000001", 'your sub-agent sa_00000001 ("Audit")', "Audit", "Which file?"]]);
    assert.equal(handed[0].d.text, 'Is it a.js or b.js?\n\n[Filament: letter lt_00000001, from your sub-agent sa_00000001 ("Audit"). It asks for a reply: once you have one, send it with Filament\'s envelope tool — answer: "lt_00000001", text: your reply. Your reply reaches it whole at its next step, while it works.]');
    assert.equal(letters.send("a", { answer: "lt_00000001", text: "b.js" }, SA).ok, false, "its writer does not answer it");
    assert.equal(letters.send("b", { answer: "lt_00000001", text: "b.js" }).ok, false, "nor another chat");
    const answered = letters.send("a", { answer: "lt_00000001", text: "It is b.js." });
    assert.equal(answered.text, 'Sent: your reply to letter lt_00000001, to sub-agent sa_00000001 ("Audit"): it reads your reply whole at its next step, while it works.');
    assert.deepEqual(told, [{ id: "sa_00000001", chainId: "a", from: "agent", text: 'It is b.js.\n\n[Filament: the reply to your letter lt_00000001 ("Which file?"), from the main agent.]' }]);
    assert.equal(letters.send("a", { answer: "lt_00000001", text: "again" }).ok, false, "answered once");
  });

  // (fails before: yes — the decision of 11-04: a sub-agent that needed its answer to go on had no way to wait for it)
  test("a sub-agent that waits in its letter's call: the agent's reply is that call's result, never words into its run as well; past its wait, a reply goes into its run", async () => {
    const { letters, handed, told } = inChat();
    const WAITS = { ...SA, waits: true };
    const sent = letters.send("a", { to: "lead", subject: "Which file?", text: "Is it a.js or b.js?", reply: true, wait: 90.5 }, WAITS);
    assert.equal(sent.text, "Sent: letter lt_00000001 to the main agent. It is at work: the letter reaches it at its next step, and it opens it when it chooses.");
    assert.deepEqual([sent.waiting?.id, sent.waiting?.seconds], ["lt_00000001", 91]);
    assert.equal(handed[0].d.text, 'Is it a.js or b.js?\n\n[Filament: letter lt_00000001, from your sub-agent sa_00000001 ("Audit"). It asks for a reply, and waits for it up to 91 s: send it with Filament\'s envelope tool — answer: "lt_00000001", text: your reply. Past its wait, your reply reaches it whole at its next step.]');
    const answered = letters.send("a", { answer: "lt_00000001", text: "It is b.js." });
    assert.equal(answered.text, 'Sent: your reply to letter lt_00000001, to sub-agent sa_00000001 ("Audit"): it waited for it, and reads it now.');
    assert.equal(await sent.waiting?.reply, 'It is b.js.\n\n[Filament: the reply to your letter lt_00000001 ("Which file?"), from the main agent.]');
    assert.equal(told.length, 0, "not into its run as well");
    assert.equal(sent.waiting?.cancel(), false, "the reply was taken");
    assert.equal(letters.send("a", { answer: "lt_00000001", text: "again" }).ok, false, "answered once");
    // Its wait ended first: the reply goes into its run, as one it never waited for.
    const later = letters.send("a", { to: "lead", subject: "And c.js?", text: "c.js too?", reply: true, wait: 5000 }, WAITS);
    assert.equal(later.waiting?.seconds, 600, "at most LETTER_WAIT_MOST");
    assert.equal(later.waiting?.cancel(), true);
    letters.send("a", { answer: "lt_00000002", text: "Yes." });
    assert.deepEqual(told.map((t) => t.text), ['Yes.\n\n[Filament: the reply to your letter lt_00000002 ("And c.js?"), from the main agent.]']);
    // A call that cannot wait (a coding agent's sub-agent's) gets no wait, nor a letter that asks no reply.
    assert.equal(letters.send("a", { to: "lead", subject: "S", text: "t", reply: true, wait: 30 }, SA).waiting, undefined);
    assert.equal(letters.send("a", { to: "lead", subject: "S", text: "t", wait: 30 }, WAITS).waiting, undefined);
  });

  test("the agent writes a sub-agent of its own that runs, whole at its next step; the sub-agent's reply comes back sealed; a team's worker hears its lead", () => {
    const { letters, handed, told } = inChat("sealed");
    const sent = letters.send("a", { to: "sa_00000001", subject: "Also c.js?", text: "Check c.js too.", reply: true });
    assert.equal(sent.text, 'Sent: letter lt_00000001 to sub-agent sa_00000001 ("Audit"): it reads your letter whole at its next step, while it works. You asked for a reply: it comes back to you as a letter. Carry on meanwhile; its report still arrives when it finishes.');
    assert.deepEqual(told, [{ id: "sa_00000001", chainId: "a", from: "agent", text: 'Check c.js too.\n\n[Filament: letter lt_00000001, "Also c.js?", from the main agent. It asks for a reply: once you have one, send it with Filament\'s envelope tool — answer: "lt_00000001", text: your reply.]' }]);
    assert.equal(letters.send("a", { answer: "lt_00000001", text: "x" }).ok, false, "its writer does not answer it");
    assert.equal(letters.send("a", { answer: "lt_00000001", text: "x" }, { agent: "sa_00000004" }).ok, false, "nor another sub-agent");
    const back = letters.send("a", { answer: "lt_00000001", text: "c.js is fine." }, SA);
    assert.equal(back.text, "Sent: your reply to letter lt_00000001, to the main agent. It was at rest: Filament wakes it, and it opens the letter when it chooses.");
    assert.deepEqual(handed.map((x) => [x.to, x.d.via, x.d.from, x.d.subject, x.d.text]), [["a", "agent", "sa_00000001", "Re: Also c.js?", 'c.js is fine.\n\n[Filament: the reply to your letter lt_00000001 ("Also c.js?"), from your sub-agent sa_00000001 ("Audit").]']]);
    letters.send("a", { to: "sa_00000004", subject: "Go", text: "Go on." });
    assert.deepEqual([told[1].from, /from your team's lead\./.test(told[1].text)], ["lead", true], "a team's worker hears its lead");
    assert.match(letters.send("a", { to: "lead", subject: "Done?", text: "?" }, { agent: "sa_00000004" }).text, /^Sent: letter lt_00000004 to your team's lead\./);
  });

  test("a sub-agent writes no other chat and no other sub-agent; the agent writes no lead, no sub-agent that ended or is another chat's; a reply to one that ended is said so", () => {
    const { letters, handed, told } = inChat();
    const refused = 'Not sent: as sub-agent sa_00000001 ("Audit") you write only to the agent that launched you — to: "lead".';
    assert.equal(letters.send("a", { to: "b", subject: "Hi", text: "?" }, SA).text, refused);
    assert.equal(letters.send("a", { to: "sa_00000004", subject: "Hi", text: "?" }, SA).text, refused);
    assert.match(letters.send("a", { to: "lead", subject: "Hi", text: "?" }).text, /^Not sent: "lead" is the agent that launched a sub-agent, and you are this chat's own agent\./);
    assert.equal(letters.send("a", { to: "sa_00000002", subject: "Hi", text: "?" }).text, 'Not sent: sub-agent sa_00000002 ("Old") is not running, so nothing reaches it now. To tell it more, follow it up with Filament\'s agent tool, agent_id "sa_00000002".');
    assert.equal(letters.send("a", { to: "sa_00000003", subject: "Hi", text: "?" }).text, "Not sent: this chat has no sub-agent sa_00000003.");
    assert.equal(letters.send("a", { to: "sa_00000001", subject: "", text: "?" }).text, "Not sent: a letter needs a subject, in one line.");
    // One whose report is not this agent's, by the registry's word (`letterBar`).
    for (const [bar, words] of [
      ["aside", 'Not sent: sub-agent sa_00000001 ("Audit") is not one you launched — its report goes to the developer.'],
      ["weighs", `Not sent: sub-agent sa_00000001 ("Audit") weighs the developer's message apart from your work, and what it finds comes to you by itself.`],
      ["waits", `Not sent: you wait for sub-agent sa_00000001 ("Audit")'s report now.`],
    ]) {
      BAR.sa_00000001 = bar;
      try {
        assert.equal(letters.send("a", { to: "sa_00000001", subject: "Hi", text: "?" }).text, words);
      } finally {
        delete BAR.sa_00000001;
      }
    }
    assert.deepEqual([handed.length, told.length], [0, 0]);
    // Another chat's letter is the chat's agent's to answer, never a sub-agent's.
    letters.heard("b", tag("a", "Cheap model"));
    letters.send("b", { to: "a", subject: "Q", text: "?", reply: true });
    assert.equal(letters.send("a", { answer: "lt_00000001", text: "no" }, SA).ok, false);
    // A sub-agent's question whose writer ended before its answer.
    letters.send("a", { to: "lead", subject: "Q2", text: "?", reply: true }, SA);
    AGENTS.sa_00000001.status = "done";
    try {
      assert.match(letters.send("a", { answer: "lt_00000002", text: "yes" }).text, /^Not sent: sub-agent sa_00000001 \("Audit"\) has finished, so nothing reaches it now\./);
    } finally {
      AGENTS.sa_00000001.status = "running";
    }
  });

  test(`letters inside the chat count against its ${LETTERS_ALONE}, whoever writes them; replies are not counted; the person's word counts from none`, () => {
    const { letters } = inChat();
    for (let i = 0; i < LETTERS_ALONE / 2; i++) {
      assert.equal(letters.send("a", { to: "sa_00000001", subject: `q${i}`, text: "?", reply: true }).ok, true);
      assert.equal(letters.send("a", { to: "lead", subject: `r${i}`, text: "?" }, SA).ok, true);
    }
    assert.match(letters.send("a", { to: "lead", subject: "one more", text: "?" }, SA).text, new RegExp(`^Not sent: this chat has sent ${LETTERS_ALONE} letters since the developer last wrote in it, the most it sends without them\\. Put what you would write in your report\\.$`));
    assert.equal(letters.send("a", { answer: "lt_00000001", text: "!" }, SA).ok, true, "a reply goes");
    letters.heard("a", "go on");
    assert.equal(letters.send("a", { to: "lead", subject: "again", text: "?" }, SA).ok, true);
  });
});

// (fails before: yes — a coding agent's sub-agent was offered no envelope tool, and its call was refused as a lead's)
describe("a sub-agent's letter's call waits for the reply (loop.js replyWait)", () => {
  /**
   * One sub-agent loop whose model writes its lead a letter that waits, then ends: what the call's result said, and
   * whether its wait was ended. @param {any} waiting @param {any} [mailbox]
   */
  const callWith = async (waiting, mailbox = { read: () => [] }) => {
    /** @type {any[]} */
    const bodies = [];
    const respond = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
    await runAgentTurn(
      /** @type {any} */ ({
        model: "m",
        messages: [{ role: "user", content: "go" }],
        system: "s",
        tools: [...toolSetFor({ delegateRead: false }), ENVELOPE_TOOL],
        rules: [],
        modeNow: () => "edit",
        root: tmpdir(),
        readerModel: "",
        maxTokens: 100,
        costOf: () => 0,
        delegateRead: null,
        mailbox,
        permissions: null,
        tree: null,
        onEvent: () => {},
        previewChars: 0,
        sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } },
        signal: null,
        resume: null,
        runHand: () => "",
        letter: () => ({ ok: true, text: "Sent: letter lt_1 to the main agent.", sent: { id: "lt_1", to: "lead", title: "the main agent", subject: "Q", reply: true }, waiting }),
        call: async (/** @type {any} */ { body }) => {
          bodies.push(structuredClone(body));
          return respond(bodies.length === 1 ? [{ type: "tool_use", id: "l1", name: "envelope", input: { to: "lead", subject: "Q", text: "Which?", reply: true, wait: 30 } }] : [{ type: "text", text: "Done." }]);
        },
      }),
    );
    const results = bodies[1].messages.at(-1).content.filter((/** @type {any} */ b) => b.type === "tool_result");
    return String(results.find((/** @type {any} */ b) => b.tool_use_id === "l1")?.content);
  };
  const SIGNED = 'B.\n\n[Filament: the reply to your letter lt_1 ("Q"), from the main agent.]';

  // (fails before: yes — the call answered at once, the reply only at a later step)
  test("the reply that comes is the call's result; at its time, or a message, the wait ends and says how the reply comes; a reply taken as it ended is the result still", async () => {
    let cancelled = 0;
    const cancel = () => (cancelled++, true);
    assert.equal(await callWith({ id: "lt_1", seconds: 30, reply: new Promise((r) => setTimeout(r, 150, SIGNED)), cancel }), `Sent: letter lt_1 to the main agent. You waited for its reply, which came after 0 s:\n\n${SIGNED}`);
    assert.equal(cancelled, 0);
    assert.equal(await callWith({ id: "lt_1", seconds: 1, reply: new Promise(() => {}), cancel }), "Sent: letter lt_1 to the main agent. You waited for its reply: no reply came within 1 s — carry on; its reply reaches you whole at your next step once it comes.");
    assert.equal(cancelled, 1, "its wait ended, so the reply goes into its run");
    /** @type {any[]} */
    const queued = [];
    /** @type {Promise<void> | null} */
    let came = null;
    const mailbox = {
      read: () => queued.splice(0),
      peek: (/** @type {(m: any) => boolean} */ pick) => queued.find(pick),
      next: () => (came ||= new Promise((r) => setTimeout(() => (queued.push({ id: "s1", kind: "note", text: "Report now.", from: "lead" }), r()), 150))),
    };
    assert.equal(await callWith({ id: "lt_1", seconds: 30, reply: new Promise(() => {}), cancel }, mailbox), "Sent: letter lt_1 to the main agent. You waited for its reply: a message came for you after 0 s, and follows; its reply reaches you whole at your next step once it comes.");
    assert.equal(cancelled, 2);
    /** @type {(text: string) => void} */
    let give = () => {};
    const late = new Promise((r) => (give = r));
    assert.equal(await callWith({ id: "lt_1", seconds: 1, reply: late, cancel: () => (give(SIGNED), false) }), `Sent: letter lt_1 to the main agent. You waited for its reply, which came after 1 s:\n\n${SIGNED}`);
  });
});

test("a coding agent's sub-agent has the envelope tool: its letter goes as its own; opening is refused in words", async () => {
  /** @type {any[]} */
  const sent = [];
  const subagents = {
    offer: () => /** @type {any} */ (null),
    asks: () => [],
    subLetter: (/** @type {string} */ id, /** @type {any} */ input) => (sent.push([id, input]), { ok: true, text: "Sent: letter lt_1 to the main agent.", sent: { id: "lt_1", to: "lead", title: "the main agent", subject: "s", reply: false } }),
  };
  const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => subagents, membersOf: () => null });
  const ctx = { cwd: "/p", upstream: "cli", chain: "c1", turn: null, graph: false, by: { id: "sa_1", exchange: 0, name: "Builder" } };
  assert.deepEqual(tools.list(ctx).map((t) => t.name), ["envelope"]);
  // The owner's tool plan of 11-08: a sub-agent's is the short envelope, loaded whole.
  assert.deepEqual([tools.list(ctx)[0].description, tools.list(ctx)[0].upfront], [TOOL_TEXT.envelopeSub, true]);
  assert.deepEqual(Object.keys(tools.list(ctx)[0].inputSchema.properties), ["to", "subject", "text", "reply", "answer"], "it writes and answers; nothing reaches it sealed to open");
  assert.deepEqual(tools.list({ ...ctx, by: null }).map((t) => t.name), [], "a chat's own agent has it beside its agent tool");
  /** @type {any[]} */
  const emitted = [];
  assert.deepEqual(await tools.call("envelope", { to: "lead", subject: "s", text: "t" }, { ...ctx, emit: (e) => void emitted.push(e) }), { text: "Sent: letter lt_1 to the main agent." });
  assert.deepEqual(sent, [["sa_1", { to: "lead", subject: "s", text: "t" }]]);
  assert.deepEqual(emitted.map((e) => [e.type, e.letter, e.to]), [["letter-sent", "lt_1", "lead"]]);
  const opened = await tools.call("envelope", { all: true }, ctx);
  assert.equal(opened.isError, true);
  assert.match(opened.text, /^Not run: nothing reaches a sub-agent sealed — the letters of the agent that launched you come whole, at your next step\./);
});

test("a sub-agent's letter on the page: its card says the sub-agent and opens it; opened, a letter; its row says whom", () => {
  const e = { n: 2, description: "Audit", via: /** @type {const} */ ("agent"), subject: "Which file?", opened: null };
  assert.equal(envelopeWords(e).head, "Envelope 2 from “Audit”");
  assert.equal(envelopeOpenedWords({ ...e, by: "tool" }), "The agent opened envelope 2, from “Audit”: its letter joined the conversation here");
  assert.equal(envelopeLineOf([{ n: 2, from: "sa_1", description: "Audit", sender: 'your sub-agent sa_1 ("Audit")', subject: "Which file?", via: "agent" }])?.words, "An envelope waits unopened for your agent, from “Audit”");
  // In the sub-agent's thread, the letters of the agent that launched it — a graph task's notes too — say whose.
  // (fails before: yes — the drive of 11-04: a sub-agent launched with no graph read "From the agent that planned its task")
  assert.equal(STEER_FROM_WORDS.agent, "From the main agent");
});

describe("the page", () => {
  // (fails before: yes — the bug hunt of 11-04 on l-ui: the timeline's events and the list kept `via` for a team's and a
  // flow's alone, so a letter's card read as a sub-agent's report, and its Open opened a sub-agent's pane)
  test("a letter's envelope names the chat that wrote it, from the run's events and from the sealed list; its opening row calls it a letter", () => {
    const from = { agentId: "a", description: "Cheap model", sender: 'the chat "Cheap model" (a)', via: "chat" };
    const c = alignEvents([
      { type: "round-start", round: 0 },
      { type: "envelope-sealed", round: 0, envelope: 2, ...from, subject: "Is 7 prime?" },
      { type: "envelope-opened", round: 0, envelope: 1, ...from, by: "tool" },
    ]).byRound.get(0);
    const [card] = c.envelopes;
    assert.deepEqual(envelopeWords(card), { head: "Envelope 2 from the chat “Cheap model”", subject: "Is 7 prime?", state: "Sealed", opened: false });
    assert.equal(envelopeOpenedWords(c.opens[0]), "The agent opened envelope 1, from the chat “Cheap model”: its letter joined the conversation here");
    assert.equal(envelopeOpenedWords({ n: 3, description: "Audit", by: "tool" }), "The agent opened envelope 3, from “Audit”: its report joined the conversation here", "a report's as it was");
    assert.equal(envelopeLineOf([{ n: 2, from: "a", description: "Cheap model", sender: from.sender, subject: "Is 7 prime?", via: "chat" }])?.words, "An envelope waits unopened for your agent, from the chat “Cheap model”");
  });

  test("the sender's row: Wrote a letter, its subject and to whom; a reply; one not sent — Filament's call and a coding agent's", () => {
    const dom = stubDocument();
    try {
      /** @param {any[]} evs */
      const rowOf = (evs) => roundRows(alignEvents([{ type: "round-start", round: 0 }, ...evs]).byRound.get(0), { runId: "run-1" })[0];
      /** @param {any} row */
      const said = (row) => [row.querySelector(".tool-kind")?.textContent, row.querySelector(".tool-primary")?.textContent, row.querySelector(".tool-secondary")?.textContent];
      const wrote = rowOf([
        { type: "tool-start", id: "l1", name: "envelope", args: argSummary("envelope", { to: "b", subject: "Is 7 prime?", text: "?" }) },
        { type: "tool-end", id: "l1", ok: true, preview: 'Sent: letter lt_1 to the chat "Good model" (b). Its agent was at rest: Filament wakes it, and it opens the letter when it chooses.' },
      ]);
      assert.deepEqual(said(wrote), ["Wrote a letter", "Is 7 prime?", "to “Good model”"]);
      assert.ok(wrote.textContent.includes("Filament's answer"));
      const refused = rowOf([
        { type: "tool-start", id: "l2", name: "envelope", args: argSummary("envelope", { to: "c", subject: "Hi", text: "?" }) },
        { type: "tool-end", id: "l2", ok: true, preview: "Not sent: you write only to a chat the developer tagged in this chat, or one that wrote to you." },
      ]);
      assert.deepEqual(said(refused).slice(0, 2), ["Letter not sent", "Hi"]);
      const replied = rowOf([{ type: "tool-start", id: "l3", name: "envelope", args: argSummary("envelope", { answer: "lt_1", text: "yes" }) }, { type: "tool-end", id: "l3", ok: true, preview: 'Sent: your reply to letter lt_1, to the chat "Cheap model" (a). Its agent was at rest.' }]);
      assert.deepEqual(said(replied), ["Replied to a letter", "lt_1", "to “Cheap model”"]);
      const opening = rowOf([{ type: "tool-start", id: "l5", name: "envelope", args: argSummary("envelope", {}) }]);
      assert.equal(said(opening)[0], "Opening envelopes", "an opening's row as it was");
      // (fails before: yes — the bug hunt of 11-04 on l-ui: a chat named by its tag, as the tool's words ask, gave a line
      // the row could not read — "Opened envelopes"; a title with quotes was cut at its first; a coding agent's call rode
      // as the tool's name, its row "Opening envelopes" whatever it did; a picture beside a letter named the picture)
      assert.equal(argSummary("envelope", { to: tag("b", "Good model"), subject: "Is 7 prime?" }), "letter to b: Is 7 prime?");
      assert.equal(argSummary("envelope", { to: "b", subject: "s", picture: "p" }), "letter to b: s", "the loop sends the letter, as its line says");
      const tagged = rowOf([
        { type: "tool-start", id: "l6", name: "envelope", args: argSummary("envelope", { to: tag("b", 'Say "hi"'), subject: "Hello", text: "?" }) },
        { type: "tool-end", id: "l6", ok: true, preview: 'Sent: letter lt_2 to the chat "Say "hi"" (b). Its agent was at rest: Filament wakes it, and it opens the letter when it chooses.' },
      ]);
      assert.deepEqual(said(tagged), ["Wrote a letter", "Hello", "to “Say \"hi\"”"]);
      /** @type {any[]} */
      const published = [];
      const run = createAgentRun({ publish: (/** @type {any} */ e) => void published.push(e), sink: { breakBlock: () => 0 }, now: () => 1000 });
      const tool = "mcp__filament__envelope";
      run.take({ type: "tool", id: "l4", toolName: tool, title: tool, kind: "other", status: "in_progress", rawInput: { text: "Is it? ".repeat(40), to: tag("b", "Good model"), subject: "From Claude", reply: true } });
      const start = published.find((e) => e.type === "tool-start");
      assert.deepEqual([start?.name, start?.args], ["envelope", "letter to b: From Claude"], "a coding agent's call rides as the loop's line of it");
      assert.deepEqual(said(rowOf([{ ...start, round: 0 }])).slice(0, 2), ["Writing a letter", "From Claude"]);
    } finally {
      dom.restore();
    }
  });

  // (fails before: yes — the drive of 11-04: the turn a letter woke said "what the agent waited on came", as for no
  // thing known)
  test("the turn a letter woke says a letter from another chat came", () => {
    assert.ok(LETTER_WAKE_LINE.startsWith(LETTER_WAKE_HEAD), "the page knows Filament's line by its head");
    const dom = stubDocument();
    try {
      const user = (/** @type {string} */ text) => ({ role: "user", content: [{ type: "text", text }] });
      const turn = (/** @type {string} */ text) => transcriptTurns({ turns: [{ n: 2, turnId: 9, requestIds: ["r9"], woke: true, user: user(text), work: [], final: { role: "assistant", content: [{ type: "text", text: "Answered." }] } }] })[0];
      const label = (/** @type {any} */ t) => wokeRow(t).querySelector(".boundary-label").textContent;
      assert.equal(label(turn(LETTER_WAKE_LINE)), "Filament went on by itself — a letter from another chat came");
      assert.equal(label(turn("[Filament: went on by itself.]")), "Filament went on by itself — what the agent waited on came", "another wake's as it was");
    } finally {
      dom.restore();
    }
  });
});

// (fails before: yes — the bug hunt of 11-04 on l-read: a chat tagged in a message sent into a running turn was never
// heard, so the agent could not write to the chat its person had just tagged)
test("a chat tagged in a message steered into a running turn is the agent's to write to", async () => {
  const { letters } = lettersOn(CHATS);
  const runs = { getRun: () => ({ meta: { chain: "a" } }), steer: () => ({ ok: true, message: {}, queued: false }) };
  const route = createRouter(runRoutes(/** @type {any} */ ({ runs, sseClients: new Set(), letters })));
  const m = route("POST", "/runs/run-1/steer");
  assert.ok(m);
  /** @type {any} */
  const res = { status: 0, body: "", headersSent: false, setHeader() {}, getHeader() {}, writeHead(/** @type {number} */ s) { this.status = s; this.headersSent = true; return this; }, write(/** @type {string} */ c) { this.body += c; }, end(c = "") { this.body += c; }, on() {} };
  const body = { kind: "note", text: `also ask ${tag("b", "Good model")}`, from: "harness" };
  await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "POST", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url: new URL("http://127.0.0.1/runs/run-1/steer"), path: "/runs/run-1/steer", method: "POST", params: m.params, json: async () => body }), /** @type {any} */ ({}));
  assert.equal(res.status, 200, res.body);
  assert.equal(letters.send("a", { to: "b", subject: "Is 7 prime?", text: "?" }).ok, true);
});

// (fails before: yes — the plan of 11-11, its w6: the steer route heard every note as the person's message, so words
// Filament, a lead, an agent or a watcher relayed into a running turn started the chat's counts again)
test("a note into a running turn that the person did not type starts none of the chat's counts again; the one they typed does", async () => {
  const { letters } = lettersOn(CHATS);
  const runs = { getRun: () => ({ meta: { chain: "a" } }), steer: () => ({ ok: true, message: {}, queued: false }) };
  const route = createRouter(runRoutes(/** @type {any} */ ({ runs, sseClients: new Set(), letters })));
  const m = route("POST", "/runs/run-1/steer");
  assert.ok(m);
  /** A note steered into the chat's run, as its sender posts it. @param {string} from @param {string} text */
  const note = async (from, text) => {
    /** @type {any} */
    const res = { status: 0, body: "", headersSent: false, setHeader() {}, getHeader() {}, writeHead(/** @type {number} */ s) { this.status = s; this.headersSent = true; return this; }, write(/** @type {string} */ c) { this.body += c; }, end(c = "") { this.body += c; }, on() {} };
    await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "POST", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url: new URL("http://127.0.0.1/runs/run-1/steer"), path: "/runs/run-1/steer", method: "POST", params: m.params, json: async () => ({ kind: "note", text, from }) }), /** @type {any} */ ({}));
    assert.equal(res.status, 200, res.body);
  };
  assert.equal(letters.threadStarted("a", 3), true);
  for (const from of ["filament", "watcher", "lead", "agent"]) {
    await note(from, `relayed, with ${tag("b", "Good model")} in it`);
    assert.equal(letters.threadsAlone("a"), 1, `${from}'s note is not the person's message`);
    assert.equal(letters.send("a", { to: "b", subject: "Is 7 prime?", text: "?" }).ok, false, `${from}'s note tags no chat for the agent`);
  }
  await note("harness", "go on");
  assert.equal(letters.threadsAlone("a"), 0, "the person's typed note is");
});

// (fails before: yes — the plan of 11-11, its w6: a watcher's chat could write the chat it reviews only where the
// person had tagged it, and nothing counted the guidance a chat was sent)
test("a watcher's chat writes the chat its watcher may guide with no tag, while Filament says it may; the guidance a chat is sent is counted for each message of its person's", () => {
  const archive = archiveOf(CHATS);
  /** @type {{ to: string, d: any }[]} */
  const handed = [];
  let may = true;
  let n = 0;
  const letters = createLetters({
    archive: () => archive,
    registry: () => ({ letter: (/** @type {string} */ to, /** @type {any} */ d) => (handed.push({ to, d }), { ok: true, at: "sealed" }) }),
    guides: (from, to) => may && from === "a" && to === "b",
    newId: () => `lt_${String(++n).padStart(8, "0")}`,
  });
  const note = { to: "b", subject: "Your last turn", text: "You drifted: the parser, not the lexer." };
  assert.equal(letters.send("a", note).ok, true, "no tag: its watcher may guide that chat");
  // (fails before: yes — version 121: the tool's `to` named a chat the person tagged and one that wrote, never this one;
  // and version 123, 031b96a65's left: never a thread linked to this chat, which `send` lets a letter go to as well)
  for (const tool of [ENVELOPE_TOOL, ENVELOPE_MAIN_TOOL])
    assert.ok(/** @type {any} */ (tool.input_schema.properties).to.description.startsWith("Write a letter: to another chat by its id, as its tag [title](chat:<id>) carries it (one the person tagged in this chat, one that wrote to you, a thread linked to this chat, or the chat your watcher may guide while it is switched on; its agent finds it sealed and opens it when it chooses); "), tool.input_schema.properties.to.description);
  assert.deepEqual(handed.map((x) => [x.to, x.d.from]), [["b", "a"]]);
  assert.equal(letters.send("a", { ...note, to: "c" }).ok, false, "only that chat");
  assert.equal(letters.send("c", note).ok, false, "only the watcher's chat");
  may = false;
  assert.match(letters.send("a", note).text, /^Not sent: you write only to a chat the developer tagged in this chat, one that wrote to you, the chat your watcher may guide while it is switched on, or a thread linked to it, and the chat "Good model" \(b\) is none of them\./);
  // The count: one step looks and counts, none past the most; one that did not go is given back; the person's message starts it again.
  assert.equal(letters.guidesAlone("b"), 0);
  assert.deepEqual([letters.guideSent("b", 3), letters.guideSent("b", 3), letters.guideSent("b", 3), letters.guideSent("b", 3), letters.guidesAlone("b")], [true, true, true, false, 3]);
  letters.guideDropped("b");
  assert.equal(letters.guidesAlone("b"), 2);
  letters.heard("b", "go on");
  assert.equal(letters.guidesAlone("b"), 0);
  letters.guideDropped("b");
  assert.equal(letters.guidesAlone("b"), 0, "never under none");
  assert.equal(archive.meta.get("b")?.letters?.guides, 0);
});

describe("the registry delivers a letter (letter)", () => {
  const root = tmpdir();
  /** @param {{ envelopes?: string }} [o] */
  const made = (o = {}) => {
    /** @type {string[]} */
    const woken = [];
    const registry = createSubagentRegistry({
      config: () => ({ agentLoop: {} }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      now: Date.now,
      context: {
        settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }], ...(o.envelopes ? { envelopes: o.envelopes } : {}) }, loop: { permissions: "edit" } }),
        session: () => ({ cwd: root, model: "m", projectId: "p1" }),
        view: async () => ({ text: "", turns: 0 }),
        brief: async () => null,
        modelProblem: () => null,
        mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
        reportWaits: (/** @type {string} */ chain) => void woken.push(chain),
      },
      call: async () => {
        throw new Error("no launch here");
      },
    });
    return { registry, woken };
  };
  /** @param {any} registry @param {{ opens?: () => boolean, before?: any }} [o] */
  const openDoor = (registry, o = {}) => registry.openTurn({ chainId: "b", runId: "turn-1", cwd: root, mode: "edit", model: "m", thinking: null, fork: null, ...o });
  /** A sub-agent's report into a running turn, as a result handed in goes. @param {any} registry */
  const report = (registry) => registry.hand("b", { id: "sa_1", text: "The report.", description: "Audit", sender: 'sub-agent sa_1 ("Audit")', subject: "Audited" });

  test("into a running turn, sealed at its next step in the chat's words; opened, the letter whole and whose chat it came from", () => {
    const { registry, woken } = made();
    const door = openDoor(registry);
    assert.deepEqual(registry.letter("b", LETTER), { ok: true, at: "turn" });
    const [line] = door.inbox.take({ seal: true });
    assert.equal(line.kind, "envelope");
    assert.match(line.text, /^\[Filament: envelope 1, sealed — from the chat "Cheap model" \(a\): Is 7 prime\? Finish what you are doing first/);
    const [opened] = door.inbox.open({});
    assert.deepEqual([opened.kind, opened.via, opened.from, opened.text], ["result", "chat", "a", LETTER.text]);
    assert.deepEqual(woken, [], "a running turn is woken by nothing");
    door.close();
  });

  test("with no turn running, sealed at once and the chat woken; the turn that comes lists it and wakes nothing more", () => {
    const { registry, woken } = made();
    assert.deepEqual(registry.letter("b", LETTER), { ok: true, at: "sealed" });
    assert.deepEqual(woken, ["b"]);
    assert.deepEqual([registry.lettersDue("b"), registry.reportsDue("b")], [true, false]);
    assert.deepEqual(registry.envelopes("b").map((e) => [e.n, e.sender, e.subject, e.via]), [[1, LETTER.sender, LETTER.subject, "chat"]], "the list the page reads says it is a chat's letter");
    const door = openDoor(registry);
    assert.equal(registry.lettersDue("b"), false, "its turn came");
    assert.deepEqual(door.inbox.sealed().map((e) => e.n), [1], "it waits sealed for the agent to open");
    door.close();
    assert.equal(registry.lettersDue("b"), false);
  });

  // (fails before: yes — the bug hunt of 11-04 on l-core and l-tool: whether letters wait sealed was the agent tool's
  // switch, so an agent without the envelope tool had its letters sealed where it could never open them)
  test("a chat that takes results whole, or whose agent opens no envelopes — as its turn says — gets it whole, woken as for a report", () => {
    const whole = made({ envelopes: "whole" });
    assert.deepEqual(whole.registry.letter("b", LETTER), { ok: true, at: "queue" });
    assert.deepEqual([whole.registry.reportsDue("b"), whole.registry.lettersDue("b"), whole.woken], [true, false, ["b"]]);
    assert.equal(whole.registry.peekQueued("b")[0].text, LETTER.text);
    const blind = made();
    const door = openDoor(blind.registry, { opens: () => false });
    blind.registry.letter("b", LETTER);
    const [took] = door.inbox.take({ seal: true });
    assert.deepEqual([took.kind, took.text], ["result", LETTER.text], "at work, its agent reads it whole");
    door.close();
    assert.deepEqual(blind.registry.letter("b", LETTER), { ok: true, at: "queue" }, "at rest, as its last turn said");
    assert.deepEqual([blind.registry.reportsDue("b"), blind.registry.envelopes("b").length], [true, 0]);
  });

  // (fails before: yes — the review of 11-04 on letters: a letter sealed at rest where the chat's agent was not known —
  // after a restart, or another agent's last turn — reached an agent with no envelope tool never: its turn's end opened
  // nothing, so a model that calls no tool had it listed sealed at every turn)
  test("one sealed before its agent was known reaches an agent that opens no envelopes whole, at its turn's end too", () => {
    const { registry } = made();
    assert.deepEqual(registry.letter("b", LETTER), { ok: true, at: "sealed" }, "no turn said whether its agent opens them");
    const door = openDoor(registry, { opens: () => false });
    const [took, ...rest] = door.inbox.take({ seal: false, end: true });
    assert.deepEqual([took?.kind, took?.opened, took?.text, rest.length], ["result", true, LETTER.text, 0]);
    assert.deepEqual(registry.envelopes("b"), []);
    door.close();
  });

  // (fails before: yes — the bug hunt of 11-04 on l-core and l-read: a letter was sealed only at a working step's take;
  // one that came as the agent waited or ended its turn arrived whole, opening every sealed envelope with it, and one
  // its turn never took went to the queue whole, waking the chat as a report)
  test("a letter stays sealed for its agent: one that comes as it waits or as its turn ends is sealed and said; a wait opens the reports, never a letter", () => {
    const { registry, woken } = made();
    const door = openDoor(registry);
    registry.letter("b", LETTER);
    const [waiting] = door.inbox.take({ seal: false });
    assert.deepEqual([waiting.kind, waiting.envelope], ["envelope", 1], "it came as the agent waited: sealed");
    report(registry);
    door.inbox.take({ seal: true });
    assert.deepEqual(door.inbox.sealed().map((e) => [e.n, e.via ?? null]), [[1, "chat"], [2, null]]);
    assert.equal(door.inbox.waitOpens(), 1, "a wait opens the report alone");
    const opened = door.inbox.take({ seal: false });
    assert.deepEqual(opened.map((t) => [t.kind, t.opened ?? false]), [["result", true]]);
    assert.deepEqual(door.inbox.sealed().map((e) => e.n), [1], "the letter stays sealed");
    registry.letter("b", { ...LETTER, subject: "Another" });
    const [ending] = door.inbox.take({ seal: false, end: true });
    assert.deepEqual([ending.kind, ending.envelope], ["envelope", 3], "it came as the turn ended: sealed, and said — the turn goes on to hear it");
    assert.match(ending.text, /^\[Filament: envelope 3, sealed — from the chat "Cheap model" \(a\): Another\./);
    registry.letter("b", { ...LETTER, subject: "Last" });
    door.close();
    assert.deepEqual([registry.lettersDue("b"), registry.reportsDue("b"), woken], [true, false, ["b"]], "one its turn never took is kept sealed, and the chat woken for it");
    assert.deepEqual(registry.envelopes("b").map((e) => e.subject), ["Is 7 prime?", "Another", "Last"]);
  });

  // (fails before: yes — the owner's of 11-04: a sub-agent's letter to the agent that launched it went as another chat's,
  // its card opening a chat of its id)
  test("a sub-agent's letter to the agent that launched it is a letter of its: sealed, kept sealed through a wait, listed with its id", () => {
    const { registry } = made();
    const door = openDoor(registry);
    assert.deepEqual(registry.letter("b", { text: "Which file?", from: "sa_1", description: "Audit", sender: 'your sub-agent sa_1 ("Audit")', subject: "Which file?", via: "agent" }), { ok: true, at: "turn" });
    const [line] = door.inbox.take({ seal: false });
    assert.deepEqual([line.kind, line.envelope], ["envelope", 1], "it came as the agent waited: sealed");
    assert.match(line.text, /^\[Filament: envelope 1, sealed — from your sub-agent sa_1 \("Audit"\): Which file\?/);
    assert.equal(door.inbox.waitOpens(), 0, "a wait opens it not");
    assert.deepEqual(door.inbox.sealed().map((e) => [e.n, e.via, e.from, e.description]), [[1, "agent", "sa_1", "Audit"]]);
    door.close();
    assert.match(registry.subLetter("sa_gone", { to: "lead", subject: "s", text: "t" }).text, /^Not sent: no sub-agent sa_gone in this session/);
  });

  // (fails before: yes — the bug hunt of 11-04 on l-core and l-tool: a letter that came while a question waited was
  // sealed and woke nothing — the wake is refused while a question waits — and the resume, which lists nothing at its
  // start, never said it; one that woke a chat drew no card, only a line that envelopes were listed)
  test("one that came while no turn ran is told once: a turn's start lists it and draws its card; a resume says it at its next step", () => {
    const { registry } = made();
    const door = openDoor(registry);
    const before = door.close({ paused: true });
    registry.letter("b", LETTER);
    const resumed = openDoor(registry, { before });
    const [said] = resumed.inbox.take({ seal: true });
    assert.deepEqual([said.kind, said.envelope, said.via], ["envelope", 1, "chat"], "the resume hears it at its next step");
    assert.deepEqual(resumed.inbox.take({ seal: true }), [], "once");
    resumed.close();
    registry.letter("b", { ...LETTER, subject: "Woke you" });
    const woke = openDoor(registry);
    assert.deepEqual(woke.inbox.fresh([]), [], "a start that listed it not tells it not");
    assert.deepEqual(woke.inbox.fresh([2]).map((e) => [e.n, e.subject, e.via]), [[2, "Woke you", "chat"]], "the turn's start lists it, with its card");
    assert.deepEqual([woke.inbox.fresh([2]), woke.inbox.take({ seal: true })], [[], []], "and nothing says it again");
    woke.close();
  });
});

// (fails before: yes — the bug hunt of 11-04 on letters: a chat kept a waiting message's words, sender and kind alone,
// so a letter sealed before a restart came back whole, as a sub-agent's report — never listed, never told as a letter —
// and so did a report sealed before it, a result handed in, a command's end and a graph task's end)
describe("what a chat keeps of its waiting messages across a restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-letters-kept-"));
  let clock = 1_760_000_000_000;
  const now = () => (clock += 1000);
  /** @type {any} */
  const cfg = { server: { host: "127.0.0.1" }, rules: {}, agentLoop: { permissions: "edit" }, memory: { enabled: true }, routes: [], upstreams: [], sessions: { defaults: {} } };
  const config = { get: () => cfg };
  const memory = new MemoryService(/** @type {any} */ ({ sidecar, getConfig: config.get, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20399", getModelNames: () => ["cheap"], now }));
  memory.start();
  const sessions = createSessions({ memory, config, pipeline: { handle: async () => {} }, ops: { record: () => {} }, log: () => {}, forkSession: async () => ({}), now });
  after(async () => {
    await memory.shutdown();
    await removeDirs(dir);
  });
  /** A Filament process's registry: what a chat keeps goes through the sessions service, as server.js wires it. */
  const processOn = () =>
    createSubagentRegistry({
      config: () => ({ agentLoop: {} }),
      log: () => {},
      events: { publish: () => {} },
      runs: null,
      now: Date.now,
      context: {
        settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "edit" } }),
        session: () => ({ cwd: dir, model: "m", projectId: "p1" }),
        view: async () => ({ text: "", turns: 0 }),
        brief: async () => null,
        modelProblem: () => null,
        mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
        saveQueue: (/** @type {string} */ chain, /** @type {any[]} */ list) => sessions.saveSubagentQueue(chain, list),
        loadQueue: (/** @type {string} */ chain) => sessions.loadSubagentQueue(chain),
      },
      call: async () => {
        throw new Error("no launch here");
      },
    });
  const chat = () => sessions.create({ cwd: dir, model: "agent/m", preset: "plain" }).id;
  /** @param {ReturnType<typeof processOn>} registry @param {string} chainId @param {string} runId */
  const openDoor = (registry, chainId, runId) => registry.openTurn({ chainId, runId, cwd: dir, mode: "edit", model: "m", thinking: null, fork: null });

  test("a letter sealed at rest comes back sealed, as a letter: listed in its envelope's words, its chat owed a wake, its card drawn once", () => {
    const b = chat();
    assert.deepEqual(processOn().letter(b, LETTER), { ok: true, at: "sealed" });
    const restarted = processOn();
    assert.deepEqual(restarted.envelopes(b).map((e) => [e.n, e.sender, e.subject, e.via]), [[1, LETTER.sender, LETTER.subject, "chat"]]);
    assert.deepEqual([restarted.lettersDue(b), restarted.reportsDue(b), restarted.peekQueued(b).length], [true, false, 0], "the chat is owed its wake, for a letter");
    const door = openDoor(restarted, b, "turn-1");
    assert.equal(processOn().lettersDue(b), false, "the turn it woke came: a restart now wakes nothing more for it");
    assert.deepEqual(door.inbox.fresh([1]).map((e) => [e.n, e.via]), [[1, "chat"]], "the turn's start draws its card");
    door.close();
    const next = openDoor(processOn(), b, "turn-2");
    assert.deepEqual(next.inbox.fresh([1]), [], "told once, across a restart too");
    const [opened] = next.inbox.open({});
    assert.deepEqual([opened.kind, opened.via, opened.from, opened.text], ["result", "chat", "a", LETTER.text]);
    next.close();
  });

  test("one a resume told at its next step is told once across a restart", () => {
    const b = chat();
    const first = processOn();
    const before = openDoor(first, b, "turn-1").close({ paused: true });
    first.letter(b, LETTER);
    const resumed = first.openTurn({ chainId: b, runId: "turn-1b", cwd: dir, mode: "edit", model: "m", thinking: null, fork: null, before });
    assert.deepEqual(resumed.inbox.take({ seal: true }).map((t) => [t.kind, t.envelope]), [["envelope", 1]], "said at its next step");
    const next = openDoor(processOn(), b, "turn-2");
    assert.deepEqual([next.inbox.fresh([1]), next.inbox.take({ seal: true })], [[], []], "nothing says it again");
    assert.deepEqual(next.inbox.sealed().map((e) => [e.n, e.via]), [[1, "chat"]], "it waits sealed");
    next.close();
    resumed.close();
  });

  test("each waiting message comes back as it was kept: a report sealed, a result whole, a command's end, a graph task's end", () => {
    const b = chat();
    /** @type {import("../src/app/agent/subagents.js").SavedDelivery[]} */
    const list = [
      { text: "Subject: Two stale keys\n\nThe keys never expire.", from: "sa_1", description: "Cache audit", kind: "report", exchange: 2, wrote: true, writes: { by: "sa_1", paths: [join(dir, "cache.js")], command: true }, seal: true, subject: "Two stale keys", sender: 'sub-agent sa_1 ("Cache audit")', envelope: 1 },
      { text: "The team's result.", from: "c9", description: "Reviewers", kind: "result", seal: true, subject: "Reviewed", sender: 'the team "Reviewers"', via: "team", wakes: true },
      { text: "npm test: 2 failing", from: "sh_1", description: "npm test", kind: "shell", code: 1 },
      { text: "t1 done", from: "", description: "Fix the cache", kind: "task", task: "t1", state: "done", wakes: true },
      { text: "Which file?", from: "sa_2", description: "Worker", kind: "ask", ask: 3 },
      { text: "Sent on.", from: "sa_3", description: "Late", kind: "report", exchange: 1, sent: true },
    ];
    sessions.saveSubagentQueue(b, list);
    assert.deepEqual(sessions.loadSubagentQueue(b), list);
    const restarted = processOn();
    assert.deepEqual(restarted.envelopes(b).map((e) => [e.n, e.subject]), [[1, "Two stale keys"]], "the sealed report stays sealed");
    assert.deepEqual(restarted.peekQueued(b).map((d) => d.kind), ["result", "shell", "task", "report"], "a worker's question goes with its run");
    assert.equal(restarted.reportsDue(b), true);
  });
});

describe("two chats in a running Filament", () => {
  /** @type {string} */
  let root;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let other = "";
  const said = (/** @type {string} */ t) => anthropicReply("", { model: "brain-model", stop: "end_turn", blocks: [{ type: "text", text: t }], usage: { input_tokens: 30, output_tokens: 7 } });
  const use = (/** @type {any} */ input) => anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: `e${Math.random().toString(36).slice(2, 8)}`, name: "envelope", input }], usage: { input_tokens: 30, output_tokens: 7 } });
  /** The text of a message's blocks of a kind. @param {any} m @param {string} type */
  const textOf = (m, type) =>
    (Array.isArray(m?.content) ? m.content : [{ type: "text", text: String(m?.content ?? "") }])
      .filter((/** @type {any} */ b) => b.type === type)
      .map((/** @type {any} */ b) => (type === "tool_result" ? (typeof b.content === "string" ? b.content : JSON.stringify(b.content)) : b.text))
      .join("\n");

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-letters-"));
    // A model that asks the other chat where its person says so, opens a letter it is woken for, and answers one that
    // asks for a reply.
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return said("A title");
      const last = call.body.messages.at(-1);
      const result = textOf(last, "tool_result");
      if (result) {
        const ask = /answer: "(lt_[0-9a-f]+)"/.exec(result);
        if (ask) return use({ answer: ask[1], text: "YES, 7 IS PRIME." });
        if (result.includes("the reply to your letter")) return said("GOT THE REPLY");
        if (result.startsWith("Sent: your reply")) return said("ANSWERED");
        if (result.startsWith("Sent: letter")) return said("ASKED");
        return said(`OTHER: ${result.slice(0, 80)}`);
      }
      const words = textOf(last, "text");
      // Woken first: the asker's chat goes by its first words, which the letter's line names it by.
      if (words.includes(LETTER_WAKE_LINE.slice(0, 50))) return use({});
      if (words.includes("ASK THE OTHER CHAT")) return use({ to: other, subject: "Is 7 prime?", text: "Please confirm: is 7 prime?", reply: true });
      return said("HI");
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir, root);
  });

  const create = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { subagents: { worktree: false } } } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const send = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** @param {string} id */
  const transcript = async (id) => /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json());
  /** The chat's turns once it has `n`, the newest ended. @param {string} id @param {number} n @param {string} what */
  const turnsOnce = (id, n, what) =>
    until(async () => {
      const t = await transcript(id);
      return (t.turns || []).length >= n && t.turns[n - 1].final ? t.turns : null;
    }, what, { timeoutMs: 30_000 });

  test("one chat asks the chat its person tagged; that chat is woken, opens the letter and answers; the asker is woken with the reply", async () => {
    const asker = await create();
    other = await create();
    await send(other, "hello");
    await send(asker, `ASK THE OTHER CHAT ${tag(other, "Good model")} whether 7 is prime`);
    const mine = await turnsOnce(asker, 1, "the asker's turn");
    assert.match(JSON.stringify(mine[0].final), /ASKED/);
    const theirs = await turnsOnce(other, 2, "the other chat woken and done");
    assert.equal(theirs[1].woke, true, "Filament's own turn");
    assert.ok(isWakeMessage(theirs[1].user), "its message ends with Filament's line");
    assert.ok(JSON.stringify(theirs[1].user).includes(LETTER_WAKE_LINE.slice(0, 50)), "in its words for a letter");
    assert.match(JSON.stringify(theirs[1].final), /ANSWERED/, "it opened the letter and answered");
    // Its card, from the chat that wrote it, drawn where the woken turn listed it: no line of envelopes listed again.
    const events = /** @type {any[]} */ ((await (await shim.api(`/api/runs/${encodeURIComponent(theirs[1].requestIds[0])}/events?since=0&limit=5000`)).json()).events);
    assert.deepEqual(events.filter((e) => e.type === "envelope-sealed").map((e) => [e.envelope, e.via, e.subject]), [[1, "chat", "Is 7 prime?"]]);
    assert.equal(events.filter((e) => e.type === "envelope-list").length, 0);
    const back = await turnsOnce(asker, 2, "the asker woken with the reply");
    assert.equal(back[1].woke, true);
    assert.match(JSON.stringify(back[1].final), /GOT THE REPLY/);
    const listed = /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(asker)}/subagents`)).json());
    assert.deepEqual(listed.envelopes || [], [], "nothing waits sealed");
  });
});

// (fails before: yes — the owner's of 11-04, "make sure this also applies to sub agents as well where main agent and sub
// agent can talk to each other": a sub-agent had no envelope tool, and the main agent's letter to its id was no chat)
describe("a main agent and its sub-agent in a running Filament", () => {
  const CHILD = "You are a sub-agent run by Filament";
  /** @type {string} */
  let root;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** Whether the main agent has answered its sub-agent and written it: the sub-agent's next step waits for it. */
  let leadWrote = false;
  /** The sub-agent's requests, in order. @type {any[]} */
  const childCalls = [];
  /** What the main agent's last request said, where its sub-agent's report came. */
  let leadSaw = "";
  /** The requests of the sub-agent that waits in its letter's call, and what its main agent saw of its report. @type {any[]} */
  const waiterCalls = [];
  let waiterSaw = "";
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  const said = (/** @type {string} */ t) => reply([{ type: "text", text: t }]);
  const use = (/** @type {string} */ name, /** @type {any} */ input) => reply([{ type: "tool_use", id: `t${Math.random().toString(36).slice(2, 8)}`, name, input }], "tool_use");
  /** All a message says, its tool results and its words. @param {any} m */
  const allOf = (m) =>
    (Array.isArray(m?.content) ? m.content : [{ type: "text", text: String(m?.content ?? "") }])
      .map((/** @type {any} */ b) => (b.type === "tool_result" ? (typeof b.content === "string" ? b.content : JSON.stringify(b.content)) : b.type === "text" ? b.text : ""))
      .join("\n");
  /** Its tool results alone. @param {any} m */
  const resultOf = (m) =>
    (Array.isArray(m?.content) ? m.content : [])
      .filter((/** @type {any} */ b) => b.type === "tool_result")
      .map((/** @type {any} */ b) => (typeof b.content === "string" ? b.content : JSON.stringify(b.content)))
      .join("\n");

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-letters-sub-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return said("A title");
      const last = call.body.messages.at(-1);
      const all = allOf(last);
      const result = resultOf(last);
      if (JSON.stringify(call.body.system ?? "").includes(CHILD)) {
        // One that only tries to write its lead, and reports what Filament said.
        if (/WRITE FROM/.test(allOf(call.body.messages[0]))) return result ? said(`CHILD SAID: ${result}`) : use("envelope", { to: "lead", subject: "Hi", text: "Hello." });
        // One that waits in its letter's call for the reply, and reports what the call said.
        if (/WAIT FOR ITS LEAD/.test(allOf(call.body.messages[0]))) {
          waiterCalls.push(call.body);
          return result ? said(`CHILD HEARD: ${result}`) : use("envelope", { to: "lead", subject: "Which file?", text: "Is it a.js or b.js?", reply: true, wait: 60 });
        }
        childCalls.push(call.body);
        // The sub-agent asks which file, works on until both its answer and the main agent's letter are in, answers
        // that letter, and reports what it heard.
        if (result.startsWith("Sent: your reply")) return said(`CHILD DONE: ${/IT IS b\.js/.test(JSON.stringify(call.body.messages)) ? "IT IS b.js" : "no answer heard"}`);
        const asked = /answer: "(lt_[0-9a-f]+)"/.exec(all);
        if (asked) return use("envelope", { answer: asked[1], text: "C.JS IS FINE" });
        if (result.startsWith("Sent: letter")) {
          await until(() => leadWrote, "the main agent's answer and letter", { timeoutMs: 20_000 });
          return use("read", { path: "a.js" });
        }
        if (result) return said(`CHILD ODD: ${result.slice(0, 120)}`);
        return use("envelope", { to: "lead", subject: "Which file?", text: "Is it a.js or b.js?", reply: true });
      }
      // The main agent launches it and waits; opens a letter as it comes; answers the one that asks; writes it back.
      if (result.includes("CHILD SAID")) return said(`LEAD SAW: ${result}`);
      if (/CHILD HEARD/.test(all)) {
        waiterSaw = all;
        return said("LEAD DONE");
      }
      if (result.includes("it waited for it, and reads it now")) return use("wait", { seconds: 60 });
      if (all.includes("LAUNCH A WAITER")) return use("agent", { run_in_background: true, description: "Waiter", prompt: "WAIT FOR ITS LEAD" });
      if (all.includes("LAUNCH IN THE FOREGROUND")) return use("agent", { run_in_background: false, description: "Fore", prompt: "WRITE FROM THE FOREGROUND" });
      if (/CHILD DONE/.test(all)) {
        leadSaw = all;
        return said("LEAD DONE");
      }
      if (result.includes("the reply to your letter")) return use("wait", { seconds: 60 });
      const ask = /answer: "(lt_[0-9a-f]+)"/.exec(result);
      if (ask) return use("envelope", { answer: ask[1], text: "IT IS b.js" });
      if (result.startsWith("Sent: your reply")) {
        const sa = /sa_[0-9a-f]{8}/.exec(result)?.[0];
        return use("envelope", { to: sa, subject: "Also c.js?", text: "Check c.js too, and tell me.", reply: true });
      }
      if (result.startsWith("Sent: letter")) {
        leadWrote = true;
        return use("wait", { seconds: 60 });
      }
      if (/a letter came|envelope \d+, sealed/.test(all)) return use("envelope", {});
      if (result) return use("wait", { seconds: 60 });
      if (all.includes("LAUNCH A HELPER")) return use("agent", { run_in_background: true, description: "Helper", prompt: "HELP WITH THE TASK" });
      return said("HI");
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir, root);
  });

  test("the sub-agent asks the main agent, which opens the letter and answers into its run; the main agent writes it, and its reply comes back sealed", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { subagents: { worktree: false } } } });
    assert.equal(r.status, 200, await r.clone().text());
    const chat = String((await r.json()).id);
    const turn = await shim.api(`/api/sessions/${encodeURIComponent(chat)}/turns`, { method: "POST", body: { content: "LAUNCH A HELPER", stream: false } });
    assert.equal(turn.status, 200, await turn.clone().text());
    const t = /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(chat)}/transcript`)).json());
    assert.match(JSON.stringify(t.turns[0].final), /LEAD DONE/);
    // The sub-agent heard the main agent's reply and its letter whole, as the main agent's, at its next step.
    const heard = allOf(childCalls.find((b) => /Message from the main agent, relayed by Filament/.test(allOf(b.messages.at(-1))))?.messages.at(-1));
    assert.match(heard, /^Message from the main agent, relayed by Filament \(2 messages\)\. Acknowledge what you heard/m);
    assert.match(heard, /IT IS b\.js\n\n\[Filament: the reply to your letter lt_[0-9a-f]{8} \("Which file\?"\), from the main agent\.\]/);
    assert.match(heard, /Check c\.js too, and tell me\.\n\n\[Filament: letter lt_[0-9a-f]{8}, "Also c\.js\?", from the main agent\. It asks for a reply/);
    assert.match(JSON.stringify(childCalls.at(-1).messages.at(-1)), /Sent: your reply to letter lt_[0-9a-f]{8}, to the main agent\./);
    // Each of the sub-agent's letters reached the main agent sealed, from it.
    const events = /** @type {any[]} */ ((await (await shim.api(`/api/runs/${encodeURIComponent(t.turns[0].requestIds[0])}/events?since=0&limit=5000`)).json()).events);
    assert.deepEqual(events.filter((e) => e.type === "envelope-sealed").map((e) => [e.envelope, e.via, e.subject, /^sa_[0-9a-f]{8}$/.test(e.agentId)]), [[1, "agent", "Which file?", true], [2, "agent", "Re: Also c.js?", true]]);
    const listed = /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(chat)}/subagents`)).json());
    assert.deepEqual(listed.envelopes || [], [], "nothing waits sealed");
    assert.match(leadSaw, /CHILD DONE: IT IS b\.js/, "its report says what it heard");
  });

  // (fails before: yes — the decision of 11-04: a sub-agent's call had no wait, and its reply came only at a later step)
  test("a sub-agent waits in its letter's call: the main agent opens the letter and answers, and the answer is that call's result — and nothing more of it reaches its run", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { subagents: { worktree: false } } } });
    assert.equal(r.status, 200, await r.clone().text());
    const chat = String((await r.json()).id);
    const turn = await shim.api(`/api/sessions/${encodeURIComponent(chat)}/turns`, { method: "POST", body: { content: "LAUNCH A WAITER", stream: false } });
    assert.equal(turn.status, 200, await turn.clone().text());
    assert.match(waiterSaw, /CHILD HEARD: Sent: letter (lt_[0-9a-f]{8}) to the main agent\. It is at work: the letter reaches it at its next step, and it opens it when it chooses\. You waited for its reply, which came after \d+ s:\n\nIT IS b\.js\n\n\[Filament: the reply to your letter \1 \("Which file\?"\), from the main agent\.\]/);
    assert.equal(waiterCalls.length, 2, "its letter, then its report");
    assert.ok(!waiterCalls.some((b) => /relayed by Filament/.test(JSON.stringify(b.messages))), "the reply did not reach its run as a message as well");
  });

  // (fails before: yes — the review of letters-sub: any sub-agent of the chat wrote its main agent — one the person kept
  // aside woke the chat at rest for a letter from an agent it never launched — and one it waited on in the foreground was
  // told its letter reaches it at its next step, which comes only after its report)
  test("a sub-agent whose report goes to the developer, and one the main agent waits on, write it no letter: told so in words, nothing woken", async () => {
    const make = async () => {
      const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { subagents: { worktree: false } } } });
      assert.equal(r.status, 200, await r.clone().text());
      return String((await r.json()).id);
    };
    const fore = await make();
    const turn = await shim.api(`/api/sessions/${encodeURIComponent(fore)}/turns`, { method: "POST", body: { content: "LAUNCH IN THE FOREGROUND", stream: false } });
    assert.equal(turn.status, 200, await turn.clone().text());
    assert.match(await turn.text(), /LEAD SAW: [\s\S]*CHILD SAID: Not sent: the agent that launched you waits for your report now and reads nothing before it — put what you would write in your report\./);
    const aside = await make();
    const spawn = await shim.api(`/api/sessions/${encodeURIComponent(aside)}/subagents`, { method: "POST", body: { prompt: "WRITE FROM ASIDE", description: "Aside", deliver: false } });
    assert.equal(spawn.status, 200, await spawn.clone().text());
    const done = await until(async () => {
      const s = (/** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(aside)}/subagents`)).json()).subagents || [])[0];
      return s && s.status !== "running" ? s : null;
    }, "the sub-agent kept aside to finish");
    assert.match(String(done.exchanges[0].report), /^CHILD SAID: Not sent: your report goes to the developer, not to an agent that launched you — put what you would write in your report\./);
    const listed = /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(aside)}/subagents`)).json());
    assert.deepEqual([listed.envelopes || [], listed.queued], [[], 0], "nothing waits for the chat's agent");
    const t = /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(aside)}/transcript`)).json());
    assert.equal((t.turns || []).length, 0, "and nothing woke the chat");
  });
});
