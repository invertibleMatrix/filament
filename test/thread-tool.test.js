// @ts-check
// The thread tool's call (app/agent/thread-tool.js, app/threads.js; the owner's of 11-09 and 11-11): a chat's agent
// starts a linked chat on the model, provider and effort it names, in this folder or another — one that is no project
// yet only on the person's yes, Full access aside; another project's as a write there would be —, the thread allowed no
// more than its starter; its first message the brief, posted as Filament's own turn; with notify, its first reply back
// as a letter, owed across a restart. At most THREAD_LIMITS.perMessage per message of the person's; none from a thread
// its person has not written in, a routine's run, a team's chat or another machine's agents'.
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createThreads } from "../src/app/threads.js";
import { LETTER_CHARS, createLetters } from "../src/app/letters.js";
import { THREAD_SWITCHED_OFF, THREAD_TOOL, folderAskOf, folderVerdict, threadAskWords, threadAtOf, threadCall, threadCtxOf } from "../src/app/agent/thread-tool.js";
import { BRIEF_END, BRIEF_HEAD, THREAD_LIMITS } from "../src/core/threads.js";
import { agentModeOf } from "../src/app/engine.js";
import { normalizeConfig } from "../src/services/config/store.js";

const root = mkdtempSync(join(tmpdir(), "filament-thread-tool-"));
const here = join(root, "site");
const elsewhere = join(root, "api");
mkdirSync(here);
mkdirSync(elsewhere);
after(() => rmSync(root, { recursive: true, force: true }));

/** The limit's words. */
const PAST = `this chat's agent started ${THREAD_LIMITS.perMessage} threads since the person last wrote, the most it starts without them: say what you would start, and wait for their word`;

/**
 * Memory's archive as the runner and letters read it, kept in the test: chats, their meta, the threads among their
 * links, and how many turns each has.
 * @param {any} starter
 */
function archiveOn(starter) {
  /** @type {Map<string, any>} */
  const chains = new Map([[starter.id, starter]]);
  /** @type {Map<string, any>} */
  const meta = new Map();
  /** @type {Map<string, string>} */
  const links = new Map();
  /** @type {Map<string, number>} */
  const turns = new Map();
  const a = {
    chains,
    meta,
    links,
    turns,
    getChain: (/** @type {string} */ id) => chains.get(id) ?? null,
    metaOf: (/** @type {string} */ id, /** @type {string[]} */ keys) => (chains.has(id) ? Object.fromEntries(keys.filter((k) => meta.get(id)?.[k] !== undefined).map((k) => [k, structuredClone(meta.get(id)[k])])) : null),
    updateMeta: (/** @type {string} */ id, /** @type {(m: any) => void} */ fn) => {
      const m = structuredClone(meta.get(id) || {});
      fn(m);
      meta.set(id, m);
      return m;
    },
    mergeMeta: (/** @type {string} */ id, /** @type {Record<string, any>} */ patch) =>
      a.updateMeta(id, (m) => {
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) delete m[k];
          else m[k] = v;
        }
      }),
    threadsOf: (/** @type {string} */ id) => ({ from: links.get(id) ?? null, started: [...links].filter(([, s]) => s === id).map(([t]) => t) }),
    newestTurnN: (/** @type {string} */ id) => turns.get(id) || 0,
    threadStarts: () => [...meta].filter(([, m]) => m.threadStart).map(([id, m]) => ({ id, start: structuredClone(m.threadStart) })),
  };
  return a;
}

/**
 * The runner on stand-ins: chats as made, turns as posted, what the person was asked — and the real letters over the
 * test's archive, so a start is counted, and a reply sent, as Filament counts and sends them. `known`: the folders that
 * are projects already; `turn`: how a brief's turn answers; `facts`: how each chat's turn stands, as the sessions
 * service reads it (`besideFacts`), changed by the test; `meta`: the starter's; `threadOf`: the chat that started it;
 * `effective`: its settings; `archive`: one kept from an earlier runner, as a restart finds it.
 * `modeOf`: the mode a turn on a model sets its coding agent to (engine.js `agentModeOf`).
 * @param {{ starter?: any, known?: string[], turn?: () => Promise<{ status: number, body: any }>, models?: Record<string, string | null>, facts?: Map<string, any>,
 *   meta?: any, threadOf?: string, effective?: any, archive?: ReturnType<typeof archiveOn>, slow?: boolean, modeOf?: (model: string) => string | null }} [o]
 */
function rig(o = {}) {
  /** @type {any[]} */
  const made = [];
  /** @type {{ id: string, body: any }[]} */
  const posted = [];
  /** @type {{ from: string, input: any, ok: boolean, said: string }[]} */
  const sent = [];
  /** The letters as the registry took them. @type {{ to: string, text: string }[]} */
  const handed = [];
  /** @type {string[]} */
  const removed = [];
  const known = new Set(o.known ?? [here]);
  const starter = o.starter ?? { id: "s1", kind: "interactive", title: "Worker" };
  const archive = o.archive ?? archiveOn(starter);
  if (starter.device || o.meta) archive.meta.set(starter.id, { ...(starter.device ? { agentDevice: starter.device } : {}), ...(o.meta || {}) });
  if (o.threadOf) {
    archive.chains.set(o.threadOf, { id: o.threadOf, kind: "interactive", title: "Its starter" });
    archive.links.set(starter.id, o.threadOf);
  }
  let n = 0;
  const letters = createLetters({
    archive: () => archive,
    registry: () => ({ letter: (/** @type {string} */ to, /** @type {any} */ d) => (handed.push({ to, text: String(d.text) }), { ok: true, at: "sealed" }) }),
    newId: () => `lt_${String(++n).padStart(8, "0")}`,
  });
  const threads = createThreads({
    sessions: {
      create: (args) => {
        made.push(args);
        const id = `t${archive.chains.size}`;
        archive.chains.set(id, { id, kind: "interactive", title: args.title });
        if (args.thread) archive.links.set(id, args.thread);
        return { id };
      },
      launchInfo: () => ({ cwd: here, model: "sonnet", full: "claude-code/sonnet" }),
      settingsOf: () => ({ effective: o.effective ?? { loop: { permissions: "read-only", rules: [{ tool: "bash", verdict: "deny" }], secondLook: true }, privacy: { bashDeny: ["rm -rf"] }, model: { name: "x" } } }),
      folderProject: (cwd) => ({ home: cwd, projectId: "p", known: known.has(cwd) }),
      besideFacts: (id) => o.facts?.get(id) ?? { busy: false, last: null },
    },
    archive: () => archive,
    registry: () => ({
      modelChoice: async (/** @type {string} */ name) => {
        if (o.slow) await new Promise((r) => setImmediate(r));
        return o.models && name in o.models ? (o.models[name] ? { model: o.models[name] } : { model: null, why: "its plan is used up" }) : { model: name };
      },
    }),
    chatEffortOf: (model, wanted) => ({ name: model, effort: wanted }),
    postTurn: (id, body) => (posted.push({ id, body }), o.turn ? o.turn() : new Promise(() => {})),
    letters: {
      threadsAlone: letters.threadsAlone,
      threadStarted: letters.threadStarted,
      threadDropped: letters.threadDropped,
      send: (from, input) => {
        const out = letters.send(from, input);
        sent.push({ from, input, ok: out.ok, said: out.text });
        return out;
      },
    },
    remove: async (id) => {
      removed.push(id);
      archive.chains.delete(id);
      archive.meta.delete(id);
      archive.links.delete(id);
    },
    folderOk: (f) => (existsSync(f) ? { ok: true, why: null } : { ok: false, why: f.startsWith(root) ? "missing" : "outside" }),
    ...(o.modeOf ? { modeOf: o.modeOf } : {}),
    wait: () => Promise.resolve(),
  });
  /** @type {any[]} */
  const asked = [];
  /** The person's answer for a folder, as a turn gives it: yes, or why not. @param {boolean} yes */
  const folder = (yes) => async (/** @type {any} */ at) => {
    asked.push(at);
    if (!yes) throw new Error("the person declined it");
    return { asked: true };
  };
  return { threads, letters, archive, made, posted, sent, handed, removed, asked, folder, starts: () => letters.threadsAlone(starter.id) };
}
/** What a runner's letters were, without how each went. @param {ReturnType<typeof rig>} r */
const lettersOf = (r) => r.sent.map((x) => ({ from: x.from, input: x.input }));
/** A runner's letters with how each went, read through a call: a check that none went yet narrows nothing here. @param {ReturnType<typeof rig>} r */
const sentOf = (r) => [...r.sent];

describe("the thread tool", () => {
  // (fails before: yes — no agent could start a chat of its own)
  test("its words: one linked chat, its brief first, letters both ways, notify, and its limit; brief alone is required", () => {
    assert.equal(THREAD_TOOL.name, "thread");
    assert.deepEqual(THREAD_TOOL.input_schema.required, ["brief"]);
    assert.deepEqual(Object.keys(THREAD_TOOL.input_schema.properties), ["title", "brief", "model", "provider", "effort", "folder", "notify"]);
    assert.match(THREAD_TOOL.description, /envelope tool, no tag needed/);
    assert.match(THREAD_TOOL.description, new RegExp(`At most ${THREAD_LIMITS.perMessage} threads per message of the person's`));
    assert.doesNotMatch(THREAD_TOOL.description, /—|--/, "a tool's words keep to plain punctuation");
    // (fails before: yes — version 120: the words had a folder that is no project yet wait for the person in every mode,
    // where Full access makes it unasked, and said nothing of another project's folder, which asks as a write there does)
    assert.match(THREAD_TOOL.description, / folder runs it in another folder\. notify /);
    assert.equal(THREAD_TOOL.input_schema.properties.folder.description, "The whole path of the folder it works in. Left out: this chat's folder. Another folder is judged as a write there would be; one that is no project yet, or is not there, asks the person first, Full access aside.");
  });

  // (fails before: yes — threads are new)
  test("a start in this chat's folder: on the model named at the effort asked, asking as its starter does; its brief posted as Filament's own turn, one block", async () => {
    const r = rig({ models: { opus: "claude-code/opus" } });
    const t = await r.threads.start("s1", { title: "Advisor", brief: "Review each diff I send you.", model: "opus", effort: "high" });
    assert.deepEqual(t, { id: "t1", title: "Advisor", model: "claude-code/opus", effort: "high", folder: here, made: false, asked: false, notify: false });
    assert.deepEqual(r.made[0], {
      cwd: here, model: "claude-code/opus", title: "Advisor", thread: "s1",
      settings: { loop: { permissions: "read-only", rules: [{ tool: "bash", verdict: "deny" }], secondLook: true }, privacy: { bashDeny: ["rm -rf"] }, model: { effort: "high" } },
    });
    assert.equal(r.posted[0].id, "t1");
    assert.equal(r.posted[0].body.by, "thread");
    assert.equal(r.posted[0].body.content.length, 1, "the brief's words ride in Filament's block, in none of their own");
    assert.ok(r.posted[0].body.content[0].text.startsWith(`${BRIEF_HEAD} "Worker" (s1).`));
    assert.ok(r.posted[0].body.content[0].text.endsWith(`${BRIEF_END}\n\nReview each diff I send you.`));
    assert.deepEqual(r.asked, [], "the chat's own folder asks nothing");
    assert.equal(r.starts(), 1, "counted until the person writes");
    const plain = await rig().threads.start("s1", { brief: "Own the API.\nMore lines." });
    assert.deepEqual([plain.model, plain.effort, plain.title], ["claude-code/sonnet", null, "Own the API."], "this chat's model; its title the brief's first line");
  });

  // (fails before: yes — threads are new)
  test("refused in words: no brief, a provider alone, a model that cannot run or names its mode, an effort that is none, a team's chat, another machine's agents'", async () => {
    const refusal = async (/** @type {any} */ input, /** @type {Parameters<typeof rig>[0]} */ o = {}) => {
      const r = rig(o);
      try {
        await r.threads.start("s1", input);
      } catch (/** @type {any} */ e) {
        assert.deepEqual(r.made, [], "nothing made");
        assert.equal(r.starts(), 0, "nothing counted");
        return [e.status, e.message];
      }
      return null;
    };
    assert.deepEqual(await refusal({ brief: " " }), [400, "say what the thread is to do: its brief is its first message"]);
    assert.deepEqual(await refusal({ brief: "x", provider: "Codex" }), [400, "provider names who serves the thread's model: name the model too"]);
    assert.deepEqual(await refusal({ brief: "x", model: "opus" }, { models: { opus: null } }), [400, "opus cannot run now (its plan is used up): name another model, or leave it out for this chat's"]);
    assert.deepEqual(await refusal({ brief: "x", model: "claude-code/sonnet@bypassPermissions" }), [400, "name the model alone: a thread asks as its starter does, so its coding agent's mode is not named"]);
    // (fails before: yes — a plain name whose route sets the mode was taken: the thread started on it, its agent asking
    // nobody — the second read of 11-12)
    const routed = normalizeConfig({
      upstreams: [{ id: "claude-code", name: "Claude Code", type: "acp", acp: { command: "claude" } }],
      routes: [{ match: "quiet/*", upstream: "claude-code", upstreamModel: "{1}@bypassPermissions", enabled: true }, { match: "claude-code/*", upstream: "claude-code", upstreamModel: "{1}", enabled: true }],
    });
    const modeOf = (/** @type {string} */ m) => agentModeOf(routed, m);
    assert.deepEqual(await refusal({ brief: "x", model: "quiet" }, { models: { quiet: "quiet/sonnet" }, modeOf }), [400, "quiet sets its coding agent's mode (bypassPermissions) by its route, and a thread asks as its starter does: name another model, or leave it out for this chat's"]);
    const plain = rig({ models: { opus: "claude-code/opus" }, modeOf });
    assert.equal((await plain.threads.start("s1", { brief: "x", model: "opus" })).model, "claude-code/opus", "a name whose route sets none starts as before");
    assert.equal((await refusal({ brief: "x", effort: "huge" }))?.[0], 400);
    assert.deepEqual(await refusal({ brief: "x" }, { starter: { id: "s1", kind: "team", title: "Team" } }), [400, "a team's chat starts no thread: its main chat's agent does"]);
    assert.deepEqual(await refusal({ brief: "x" }, { starter: { id: "s1", kind: "interactive", title: "Theirs", device: "d1" } }), [403, "a chat of another machine's agents starts no thread on this machine"]);
    assert.match(String((await refusal({ brief: "x", folder: "site" }))?.[1]), /folder is a whole path/);
  });

  // (fails before: no — a guard, repaired: the limit was proved on a counter the test kept itself; this one runs on the
  // letters' own count, and on the person's message starting it from none)
  test(`past the limit, on the letters' own count: ${THREAD_LIMITS.perMessage} start, the next is refused, and the person's message counts from none again`, async () => {
    const r = rig();
    for (let i = 0; i < THREAD_LIMITS.perMessage; i++) await r.threads.start("s1", { brief: `Part ${i}.` });
    assert.equal(r.letters.threadsAlone("s1"), THREAD_LIMITS.perMessage);
    await assert.rejects(r.threads.start("s1", { brief: "One more." }), { status: 429, message: PAST });
    assert.equal(r.made.length, THREAD_LIMITS.perMessage, "nothing made past it");
    assert.equal(r.letters.threadsAlone("s1"), THREAD_LIMITS.perMessage, "nor counted");
    r.letters.heard("s1", "Carry on.");
    assert.equal(r.letters.threadsAlone("s1"), 0);
    assert.equal((await r.threads.start("s1", { brief: "One more." })).id, `t${THREAD_LIMITS.perMessage + 1}`);
  });

  // (fails before: yes — the limit was looked at, then counted after the model was read and the person asked: starts
  // that ran side by side all passed the look)
  test("starts that run side by side take a slot each: none passes the limit, and one refused or failed gives its slot back", async () => {
    const r = rig({ slow: true, models: { opus: "claude-code/opus" } });
    const all = await Promise.allSettled(Array.from({ length: THREAD_LIMITS.perMessage + 2 }, (_, i) => r.threads.start("s1", { brief: `Part ${i}.`, model: "opus" })));
    assert.equal(all.filter((x) => x.status === "fulfilled").length, THREAD_LIMITS.perMessage);
    assert.deepEqual(all.filter((x) => x.status === "rejected").map((x) => /** @type {any} */ (x).reason.message), [PAST, PAST]);
    assert.equal(r.made.length, THREAD_LIMITS.perMessage, "none made past the limit");
    // A brief its thread refuses at once, and a folder the person says no to: neither counts.
    const bad = rig({ turn: async () => ({ status: 400, body: { error: "the model cannot answer" } }) });
    await assert.rejects(bad.threads.start("s1", { brief: "x" }), { status: 400 });
    assert.equal(bad.starts(), 0, "a start that failed is not counted");
    const no = rig();
    await assert.rejects(no.threads.start("s1", { brief: "x", folder: join(root, "never") }, { folder: no.folder(false) }), { status: 403 });
    assert.equal(no.starts(), 0, "nor one the person refused");
  });

  // (fails before: yes — a thread's agent started threads of its own, each counting its limit anew with nobody's word
  // between them; so did a routine's run)
  test("a thread starts none of its own until its person wrote in it, and a routine's run starts none: each refused in words that say what to do instead", async () => {
    const own = rig({ threadOf: "s0" });
    await assert.rejects(own.threads.start("s1", { brief: "Review." }), {
      status: 403,
      message: 'a thread starts none of its own until its person writes in it: say in your reply which thread you would start and why, or ask your starter for it in a letter (Filament\'s envelope tool, to: "s0")',
    });
    assert.deepEqual([own.made, own.starts()], [[], 0]);
    const written = rig({ threadOf: "s0", meta: { personAt: 1794000000000 } });
    assert.equal((await written.threads.start("s1", { brief: "Review." })).id, "t2", "its person wrote in it: it starts them as any chat");
    const run = rig({ meta: { routine: { project: "p", id: "r1", title: "Nightly" }, personAt: 1794000000000 } });
    await assert.rejects(run.threads.start("s1", { brief: "Review." }), { status: 403, message: "a routine's run starts no thread: say in your reply which thread you would start and why, for its person to read" });
    assert.deepEqual(run.made, []);
    // As the tool hands it back.
    const at = threadAtOf({ start: (chain, input, ctx) => own.threads.start(chain, input, ctx), starts: () => true, on: () => true }, "s1");
    const said = await threadCall({ brief: "Review." }, /** @type {any} */ (at));
    assert.equal(said.ok, false);
    assert.match(String(!said.ok && said.error), /^Not started: a thread starts none of its own until its person writes in it: .* to: "s0"\)\.$/);
  });

  // (fails before: yes — threads are new; and a project's folder that is not the chat's own started unasked)
  test("another folder: one that is no project asks the person, made only on their yes; another project's asks too; outside the roots, refused unasked; with no turn to ask in, refused", async () => {
    const fresh = join(root, "new-app");
    const no = rig();
    await assert.rejects(no.threads.start("s1", { brief: "Build it.", folder: fresh }, { folder: no.folder(false) }), { status: 403, message: /^the thread did not start in .*new-app: the person declined it$/ });
    assert.equal(existsSync(fresh), false, "nothing made");
    assert.deepEqual(no.made, []);
    assert.deepEqual(no.asked, [{ folder: fresh, fresh: true }]);
    const yes = rig();
    const t = await yes.threads.start("s1", { brief: "Build it.", folder: fresh }, { folder: yes.folder(true) });
    assert.equal(existsSync(fresh), true, "made on the yes");
    assert.deepEqual([t.folder, t.made, t.asked], [fresh, true, true]);
    // A project's folder that is not the chat's own: asked for as a write there would be, and no project is made.
    const other = rig({ known: [here, elsewhere] });
    const o = await other.threads.start("s1", { brief: "Own the API.", folder: elsewhere }, { folder: other.folder(true) });
    assert.deepEqual(other.asked, [{ folder: elsewhere, fresh: false }]);
    assert.deepEqual([o.made, o.asked], [false, true]);
    // Where the chat's mode runs it unasked, the start says nobody was asked.
    const auto = rig({ known: [here, elsewhere] });
    const u = await auto.threads.start("s1", { brief: "Own the API.", folder: elsewhere }, { folder: async () => ({ asked: false }) });
    assert.deepEqual([u.made, u.asked], [false, false]);
    await assert.rejects(rig().threads.start("s1", { brief: "x", folder: elsewhere }), { status: 409, message: "a new project folder needs the person's yes, and no turn of this chat runs now to ask it" });
    await assert.rejects(rig({ known: [here, elsewhere] }).threads.start("s1", { brief: "x", folder: elsewhere }), { status: 409, message: "another folder than this chat's own needs the person's yes, and no turn of this chat runs now to ask it" });
    const outside = process.platform === "win32" ? "Z:\\nowhere\\x" : "/nowhere/x";
    const out = rig();
    await assert.rejects(out.threads.start("s1", { brief: "x", folder: outside }, { folder: out.folder(true) }), { status: 403, message: /under no folder listed in agentLoop\.roots/ });
    assert.deepEqual(out.asked, [], "never asked");
  });

  // (fails before: yes — the folder was asked for wherever a write there asks, so Edit's write inside the chat's folder,
  // a rule's allow and an always-allow started a new project unasked)
  test("whether a folder is asked for: one no project holds asks whatever a write there would do, Full access aside; another as the write would; and in the thread's own words", () => {
    assert.equal(folderVerdict(true, "run", "edit"), "ask", "Edit runs a write inside the chat's folder: a new project asks all the same");
    assert.equal(folderVerdict(true, "run", "ask"), "ask", "so does an always-allow's or a rule's run");
    assert.equal(folderVerdict(true, "run", "auto"), "run", "Full access asks nothing");
    assert.equal(folderVerdict(true, "refuse", "read-only"), "refuse");
    assert.equal(folderVerdict(true, "ask", "edit"), "ask");
    assert.deepEqual([folderVerdict(false, "run", "edit"), folderVerdict(false, "ask", "edit"), folderVerdict(false, "refuse", "edit")], ["run", "ask", "refuse"], "another project's, as a write there");
    assert.equal(threadAskWords({ title: "Site" }, "C:\\work\\site"), "May I start the thread “Site” in C:\\work\\site? No project holds that folder yet: it becomes one, made where it is not there — answer /allow to start it, or say what to do instead.");
    assert.equal(threadAskWords({}, "C:\\work\\api", false), "May I start a thread in C:\\work\\api? It is not this chat's own folder: the thread's agent works there as this chat's does here — answer /allow to start it, or say what to do instead.");
  });

  // (fails before: yes — a coding agent's call judged the folder as a write and no more: a write the mode ran started a
  // new project unasked, and one it asked about asked in a write's words)
  test("a coding agent's turn asks for the folder on its card, in the thread's words: a yes starts it, a no or no answer does not, the switch's own refusal says so", async () => {
    /** A turn as agent-tools.js gives it: what the switch answers a write, the mode, and the person's answer to a card. @param {{ verdict: "run" | "ask" | "refuse", mode: string, answer?: any }} o */
    const turn = (o) => {
      /** @type {any[]} */
      const cards = [];
      /** @type {string[]} */
      const permits = [];
      return {
        cards,
        permits,
        judgeNow: () => o.verdict,
        modeNow: () => o.mode,
        permit: async (/** @type {any} */ _calls, /** @type {string} */ what) => {
          permits.push(what);
          if (o.verdict === "refuse") throw new Error("read-only mode refused it");
          return { asked: false };
        },
        askPerson: async (/** @type {any} */ form) => (cards.push(form), o.answer ?? { outcome: "cancelled" }),
      };
    };
    const yes = { outcome: "answered", answers: { permission: { chosen: ["allow"] } } };
    const inside = turn({ verdict: "run", mode: "edit", answer: yes });
    assert.deepEqual(await folderAskOf(inside, { title: "Site" })?.({ folder: "C:\\work\\site", fresh: true }), { asked: true });
    assert.equal(inside.cards.length, 1, "Edit would run the write: the person is asked all the same");
    assert.equal(inside.cards[0].title, threadAskWords({ title: "Site" }, "C:\\work\\site"));
    assert.deepEqual([inside.cards[0].kind, inside.cards[0].judged?.tool, inside.permits], ["permission", "thread", []]);
    const auto = turn({ verdict: "run", mode: "auto" });
    assert.deepEqual(await folderAskOf(auto, {})?.({ folder: "C:\\work\\site", fresh: true }), { asked: false });
    assert.deepEqual([auto.cards.length, auto.permits], [0, ["start a thread in C:\\work\\site"]], "Full access: on the switch's record, nobody asked");
    const no = turn({ verdict: "ask", mode: "edit", answer: { outcome: "answered", answers: { permission: { chosen: ["deny"], words: "not there" } } } });
    await assert.rejects(Promise.resolve(folderAskOf(no, {})?.({ folder: "C:\\work\\api", fresh: false })), { message: 'the person declined it — "not there"' });
    assert.equal(no.cards[0].title, threadAskWords({}, "C:\\work\\api", false));
    await assert.rejects(Promise.resolve(folderAskOf(turn({ verdict: "ask", mode: "edit" }), {})?.({ folder: "C:\\work\\api", fresh: false })), { message: "the question was not answered" });
    const shut = turn({ verdict: "refuse", mode: "read-only" });
    await assert.rejects(Promise.resolve(folderAskOf(shut, {})?.({ folder: "C:\\work\\site", fresh: true })), { message: "read-only mode refused it" });
    assert.equal(shut.cards.length, 0, "never asked");
    assert.equal(folderAskOf({ permit: null, judgeNow: null, askPerson: null }, {}), null, "no turn, nobody to ask");
  });

  // (fails before: yes — the thread took its starter's mode and rules, and its own project's tool switches and privacy:
  // a starter with a tool switched off, or kept from the learner, started a thread that had neither)
  test("the thread may no more than its starter: its tool switches and what memory may learn, index and must redact go with its asking settings", async () => {
    const r = rig({ effective: { loop: { permissions: "ask", tools: { web_fetch: false, thread: true } }, privacy: { bashDeny: ["rm -rf"], learn: false, index: false, redact: ["sk-[a-z0-9]+"] } } });
    await r.threads.start("s1", { brief: "Review." });
    assert.deepEqual(r.made[0].settings, {
      loop: { permissions: "ask", tools: { web_fetch: false, thread: true } },
      privacy: { bashDeny: ["rm -rf"], learn: false, index: false, redact: ["sk-[a-z0-9]+"] },
    });
  });

  // (fails before: yes — a thread took its starter chat's own mode, whatever the turn that started it ran in: a turn
  // Filament holds to reading — a plan's, a watcher's wake — started a thread that wrote, in a chat set to Full access)
  test("a thread started from a turn held to reading reads only, whatever its starter's own mode; from any other turn it asks as its starter does", async () => {
    const eff = { loop: { permissions: "auto", rules: [{ tool: "bash", verdict: "ask" }] } };
    const held = rig({ effective: eff });
    await held.threads.start("s1", { brief: "Review." }, { mode: () => "read-only" });
    assert.deepEqual(held.made[0].settings, { loop: { permissions: "read-only", rules: [{ tool: "bash", verdict: "ask" }] } });
    for (const mode of [() => "auto", () => "ask", () => null, undefined]) {
      const r = rig({ effective: eff });
      await r.threads.start("s1", { brief: "Review." }, mode ? { mode } : {});
      assert.deepEqual(r.made[0].settings, { loop: { permissions: "auto", rules: [{ tool: "bash", verdict: "ask" }] } });
    }
    // The tool hands the runner its turn's mode, from either door: a coding agent's turn through its context.
    /** @type {any[]} */
    const got = [];
    const at = { start: async (/** @type {any} */ _input, /** @type {any} */ ctx) => (got.push(ctx.mode?.()), { id: "t1", title: "T", model: "m", effort: null, folder: "f", made: false, asked: false, notify: false }) };
    await threadCall({ brief: "Review." }, /** @type {any} */ (at), threadCtxOf({ modeNow: () => "read-only" }, {}));
    assert.deepEqual(got, ["read-only"]);
  });

  // (fails before: yes — the runner read `loop.folders`, a name no setting has: the folders its starter added for
  // reading, `loop.addedFolders`, never reached the thread, though the guide says its folders go with it)
  test("the folders its starter added for reading go with its asking settings", async () => {
    const r = rig({ effective: { loop: { permissions: "ask", addedFolders: ["C:\work\shared", "C:\work\docs"] } } });
    await r.threads.start("s1", { brief: "Review." });
    assert.deepEqual(r.made[0].settings, { loop: { permissions: "ask", addedFolders: ["C:\work\shared", "C:\work\docs"] } });
    // Its starter's layers add up past what one layer holds: the thread's own layer takes the first sixteen.
    const many = Array.from({ length: 20 }, (_, i) => `C:\work\f${i}`);
    const full = rig({ effective: { loop: { addedFolders: many } } });
    await full.threads.start("s1", { brief: "Review." });
    assert.deepEqual(full.made[0].settings, { loop: { addedFolders: many.slice(0, 16) } });
  });

  // (fails before: yes — the runner said why only as it started, which the loop called after it had asked the person for
  // the folder: it had no `refusal` to read first; thread-offer's test covers the loop)
  test("what refuses a start whatever the person answers is said before anyone is asked, and counts nothing", async () => {
    const fresh = join(root, "unasked");
    const r = rig({ models: { opus: null } });
    assert.equal(await r.threads.refusal("s1", { brief: "x", model: "opus", folder: fresh }), "opus cannot run now (its plan is used up): name another model, or leave it out for this chat's");
    assert.equal(await r.threads.refusal("s1", { brief: "x", folder: fresh }), null, "one that would go on to ask");
    await assert.rejects(r.threads.start("s1", { brief: "x", model: "opus", folder: fresh }, { folder: r.folder(true) }), { status: 400 });
    assert.deepEqual([r.asked, r.made, r.starts(), existsSync(fresh)], [[], [], 0, false]);
    assert.deepEqual(r.threads.asks("s1", { folder: fresh }), { folder: fresh, fresh: true });
    assert.equal(r.threads.asks("s1", {}), null, "the chat's own folder");
  });

  // (fails before: yes — threads are new)
  test("a brief refused at once takes the thread back and says why", async () => {
    const bad = rig({ turn: async () => ({ status: 400, body: { error: "the model cannot answer" } }) });
    await assert.rejects(bad.threads.start("s1", { brief: "x", notify: true }), { status: 400, message: "the thread could not start: the model cannot answer" });
    assert.deepEqual(bad.removed, ["t1"]);
    bad.threads.released("t1");
    assert.deepEqual(bad.sent, [], "and owes no reply");
  });

  // (fails before: yes — the trial of 11-11 on a real Filament: the server's post answers at its head, as the turn begins,
  // so notify wrote "Its first turn ended with no reply" of a turn that went on to reply)
  test("notify sends its first reply once the brief's turn lets go of the chat, read from that turn, never at the post's answer", async () => {
    const facts = new Map();
    const r = rig({ turn: async () => ({ status: 200, body: null }), facts });
    const t = await r.threads.start("s1", { title: "Advisor", brief: "Review.", notify: true });
    assert.equal(t.notify, true);
    await new Promise((res) => setImmediate(res));
    assert.deepEqual(r.sent, [], "the post answered as its turn began: nothing yet");
    facts.set("t1", { busy: true, asking: false, last: { n: 1, text: "", why: "", failed: false, stopped: false, endedAt: null } });
    r.threads.released("t1");
    assert.deepEqual(r.sent, [], "still at work: it waits for the next");
    facts.set("t1", { busy: false, asking: false, last: { n: 1, text: "Ready: send me the first diff.", why: "", failed: false, stopped: false, endedAt: 5 } });
    r.threads.released("t1");
    r.threads.released("t1");
    assert.deepEqual(lettersOf(r), [{ from: "t1", input: { to: "s1", subject: "Advisor: its first reply", text: "Ready: send me the first diff." } }], "once");
    assert.equal(sentOf(r)[0].ok, true, sentOf(r)[0].said);
    // A turn that failed says why; a chat no thread is owed for is let be.
    await r.threads.start("s1", { title: "Builder", brief: "Build.", notify: true });
    facts.set("t2", { busy: false, asking: false, last: { n: 1, text: "", why: "the connection was reset", failed: true, stopped: false, endedAt: null } });
    r.threads.released("t2");
    r.threads.released("elsewhere");
    assert.equal(sentOf(r)[1]?.input.text, "Its first turn ended with no reply (the connection was reset). Open the chat to see why.");
    assert.equal(sentOf(r).length, 2);
    // Without notify, nothing comes back by itself.
    await r.threads.start("s1", { title: "Quiet", brief: "Wait." });
    facts.set("t3", { busy: false, asking: false, last: { n: 1, text: "Waiting.", why: "", failed: false, stopped: false, endedAt: 9 } });
    r.threads.released("t3");
    assert.equal(sentOf(r).length, 2);
  });

  // (fails before: yes — a first turn that asked the person a question let go of its chat, and its question went to the
  // starter as the thread's first reply; one a restart cut off went as "ended with no reply")
  test("notify waits while the thread's turn asks the person, and for a turn cut off before any reply: the reply that follows is the one sent", async () => {
    const facts = new Map();
    const r = rig({ turn: async () => ({ status: 200, body: null }), facts });
    await r.threads.start("s1", { title: "Advisor", brief: "Review.", notify: true });
    facts.set("t1", { busy: false, asking: true, last: { n: 1, text: "May I run this command? `npm test`", why: "", failed: false, stopped: false, endedAt: null } });
    r.threads.released("t1");
    assert.deepEqual(r.sent, [], "a question for the person is no reply");
    facts.set("t1", { busy: false, asking: false, last: { n: 1, text: "", why: "", failed: false, stopped: false, endedAt: null, cut: true } });
    r.threads.released("t1");
    assert.deepEqual(r.sent, [], "cut off before any reply: its next turn's end says");
    facts.set("t1", { busy: false, asking: false, last: { n: 2, text: "The tests pass.", why: "", failed: false, stopped: false, endedAt: 7 } });
    r.threads.released("t1");
    assert.deepEqual(sentOf(r).map((x) => x.input.text), ["The tests pass."]);
  });

  // (fails before: yes — a reply longer than a letter holds was refused by the letters, and the refusal only logged: the
  // starter that asked for it heard nothing)
  test("a first reply longer than a letter holds is sent as far as one holds, saying the rest is in the thread's chat", async () => {
    const facts = new Map();
    const r = rig({ turn: async () => ({ status: 200, body: null }), facts });
    await r.threads.start("s1", { title: "Advisor", brief: "Review.", notify: true });
    const long = `${"A long review. ".repeat(2000)}THE END`;
    assert.ok(long.length > LETTER_CHARS);
    facts.set("t1", { busy: false, asking: false, last: { n: 1, text: long, why: "", failed: false, stopped: false, endedAt: 5 } });
    r.threads.released("t1");
    assert.equal(r.sent.length, 1);
    assert.equal(r.sent[0].ok, true, r.sent[0].said);
    const text = String(r.sent[0].input.text);
    assert.ok(text.length <= LETTER_CHARS, String(text.length));
    assert.ok(text.startsWith("A long review. A long review. "));
    assert.ok(text.endsWith(`\n\n[Filament: its reply is ${long.length.toLocaleString("en-US")} characters, more than a letter holds: this is how it begins, and the rest is in its chat (t1).]`), text.slice(-200));
    assert.equal(r.handed.length, 1, "the letters took it");
    assert.ok(r.handed[0].text.startsWith("A long review. "));
  });

  // (fails before: yes — the reply was owed only once the post's wait was over, in this process alone: a turn that ended
  // within the wait, and any turn that ended after a restart, sent nothing)
  test("the reply is owed from before the brief is posted, and across a restart: kept on the thread's chat, read back as Filament starts, taken away once sent", async () => {
    // A turn that ended before the post's wait was over.
    const facts = new Map();
    /** @type {ReturnType<typeof rig>} */
    const quick = rig({
      facts,
      turn: async () => {
        facts.set("t1", { busy: false, asking: false, last: { n: 1, text: "Done already.", why: "", failed: false, stopped: false, endedAt: 3 } });
        quick.threads.released("t1");
        return { status: 200, body: null };
      },
    });
    await quick.threads.start("s1", { title: "Quick", brief: "Say done.", notify: true });
    assert.deepEqual(quick.sent.map((x) => x.input.text), ["Done already."]);
    assert.equal(quick.archive.meta.get("t1")?.threadStart, undefined, "sent: nothing owed");
    // Kept before the post; a new runner over the same archive — a restart — owes it again.
    /** @type {any} */
    let atPost = null;
    /** @type {ReturnType<typeof rig>} */
    const first = rig({ turn: async () => ((atPost = structuredClone(first.archive.meta.get("t1")?.threadStart)), { status: 200, body: null }) });
    await first.threads.start("s1", { title: "Advisor", brief: "Review.", notify: true });
    assert.deepEqual(atPost, { starter: "s1", title: "Advisor", notify: true }, "on the chat as its brief is posted");
    first.archive.turns.set("t1", 1);
    const later = new Map();
    const again = rig({ archive: first.archive, facts: later });
    again.threads.released("t1");
    assert.deepEqual(again.sent, [], "a runner that read nothing back owes nothing");
    assert.deepEqual(again.threads.reconcile(), { back: 0, owes: 1 });
    assert.deepEqual(again.sent, [], "its turn has not ended: it waits");
    later.set("t1", { busy: false, asking: false, last: { n: 2, text: "Ready after the restart.", why: "", failed: false, stopped: false, endedAt: 8 } });
    again.threads.released("t1");
    assert.deepEqual(lettersOf(again), [{ from: "t1", input: { to: "s1", subject: "Advisor: its first reply", text: "Ready after the restart." } }]);
    assert.equal(first.archive.meta.get("t1")?.threadStart, undefined, "taken away once sent");
    assert.deepEqual(rig({ archive: first.archive }).threads.reconcile(), { back: 0, owes: 0 });
    // A reply that stood as Filament stopped is sent as it starts.
    const stood = rig({ turn: async () => ({ status: 200, body: null }) });
    await stood.threads.start("s1", { title: "Stood", brief: "Review.", notify: true });
    stood.archive.turns.set("t1", 1);
    const up = rig({ archive: stood.archive, facts: new Map([["t1", { busy: false, asking: false, last: { n: 1, text: "It stood.", why: "", failed: false, stopped: false, endedAt: 4 } }]]) });
    assert.deepEqual(up.threads.reconcile(), { back: 0, owes: 0 });
    assert.deepEqual(up.sent.map((x) => x.input.text), ["It stood."]);
    // A post that failed past its wait owes nothing more, as Filament starts again either.
    const broke = rig({ turn: () => new Promise((_, no) => setImmediate(() => no(new Error("the turn broke")))) });
    await broke.threads.start("s1", { title: "Broke", brief: "Review.", notify: true });
    await new Promise((res) => setImmediate(res));
    await new Promise((res) => setImmediate(res));
    assert.deepEqual(broke.archive.meta.get("t1")?.threadStart, { starter: "s1", title: "Broke", notify: false });
    broke.archive.turns.set("t1", 1);
    const after = rig({ archive: broke.archive, facts: new Map([["t1", { busy: false, asking: false, last: { n: 1, text: "", why: "the turn broke", failed: true, stopped: false, endedAt: null } }]]) });
    assert.deepEqual(after.threads.reconcile(), { back: 0, owes: 0 });
    assert.deepEqual(sentOf(after), [], "the debt its failure dropped is not owed again");
    assert.equal(broke.archive.meta.get("t1")?.threadStart, undefined, "settled");
  });

  // (fails before: yes — a stop between the chat made and its brief posted left an empty chat linked to its starter for good)
  test("a thread whose brief never became a turn is taken back as Filament starts; one whose turn began is settled", async () => {
    // The post never answered, and Filament stopped: the chat is there, marked, with no turn.
    const cut = rig();
    void cut.threads.start("s1", { title: "Never briefed", brief: "Review." });
    await new Promise((res) => setImmediate(res));
    assert.deepEqual([...cut.archive.chains.keys()], ["s1", "t1"]);
    assert.deepEqual(cut.archive.meta.get("t1")?.threadStart, { starter: "s1", title: "Never briefed", notify: false });
    const up = rig({ archive: cut.archive });
    assert.deepEqual(up.threads.reconcile(), { back: 1, owes: 0 });
    await new Promise((res) => setImmediate(res));
    assert.deepEqual(up.removed, ["t1"]);
    assert.deepEqual([...cut.archive.chains.keys()], ["s1"]);
    // One whose brief's turn began keeps its chat, its start settled as the post answers.
    const ok = rig({ turn: async () => ({ status: 200, body: null }) });
    await ok.threads.start("s1", { title: "Briefed", brief: "Review." });
    await new Promise((res) => setImmediate(res));
    assert.equal(ok.archive.meta.get("t1")?.threadStart, undefined);
    assert.deepEqual(rig({ archive: ok.archive }).threads.reconcile(), { back: 0, owes: 0 });
  });

  // (fails before: yes — threads are new; and the answer said "a new project the person allowed" of one nobody was asked for)
  test("the call: its answer names the thread, how to write it and what comes back, and says of its folder what happened; switched off, or refused, in words", async () => {
    const r = rig();
    const at = threadAtOf({ start: (chain, input, ctx) => r.threads.start(chain, input, ctx), starts: (c) => c === "s1", on: () => true }, "s1");
    assert.ok(at);
    const ok = await threadCall({ title: "Advisor", brief: "Review." }, /** @type {any} */ (at));
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.text, `Started the thread "Advisor" (t1) on claude-code/sonnet in ${here}: it reads your brief now. Write it with Filament's envelope tool, to: "t1". Nothing comes back by itself: it writes you when its brief says to. Go on with your work.`);
    const asked = join(root, "asked-app");
    const yes = await threadCall({ title: "Site", brief: "Build." , folder: asked }, /** @type {any} */ (at), { folder: async () => ({ asked: true }) });
    assert.match(String(yes.ok && yes.text), /^Started the thread "Site" \(t2\) on claude-code\/sonnet in .*asked-app, a new project the person allowed: it reads your brief now\./);
    const unasked = join(root, "unasked-app");
    const auto = await threadCall({ title: "Site", brief: "Build.", folder: unasked }, /** @type {any} */ (at), { folder: async () => ({ asked: false }) });
    assert.match(String(auto.ok && auto.text), /^Started the thread "Site" \(t3\) on claude-code\/sonnet in .*unasked-app, a new project made unasked as this chat's mode lets it: it reads your brief now\./);
    const other = rig({ known: [here, elsewhere] });
    const there = await threadCall({ title: "API", brief: "Own it.", folder: elsewhere }, { chain: "s1", start: (input, ctx) => other.threads.start("s1", input, ctx) }, { folder: async () => ({ asked: true }) });
    assert.match(String(there.ok && there.text), /^Started the thread "API" \(t1\) on claude-code\/sonnet in .*api, which the person allowed: it reads your brief now\./);
    assert.equal(threadAtOf({ start: async () => /** @type {any} */ ({}), starts: () => false, on: () => true }, "s2"), null, "a chat that starts none is offered none");
    const off = await threadCall({ brief: "x" }, { chain: "s1", start: async () => /** @type {any} */ ({}), on: () => false });
    assert.deepEqual(off, { ok: false, error: THREAD_SWITCHED_OFF });
    const no = await threadCall({ brief: "" }, /** @type {any} */ (at));
    assert.deepEqual(no, { ok: false, error: "Not started: say what the thread is to do: its brief is its first message." });
    const shut = await threadCall({ brief: "x", folder: join(root, "shut-app") }, /** @type {any} */ (at), { folder: async () => Promise.reject(new Error("read-only mode refused it")) });
    assert.match(String(!shut.ok && shut.error), /^Not started: the thread did not start in .*shut-app: read-only mode refused it\.$/);
  });
});
