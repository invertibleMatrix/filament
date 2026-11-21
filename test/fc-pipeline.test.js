// @ts-check
// HarnessV3-Facade Phase FC on the live app: the composed request obeys the preset (FC 6), the mute stops recall
// for the harness's session and for an outside client's (FC 7), and the `turns` topic plus the holders
// route say who holds each session's turn (FC 10). Timing comes from gates and `until` — no fixed sleeps.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeUpstream, anthropicReply, startApp } from "./helpers/app.js";
import { until, upstreamControls, readEvents, removeDirs } from "./helpers/wait.js";
import { chainKeyForConversationId } from "../src/services/memory/brain.js";

describe("Phase FC on the live app: the preset composes, the mute silences recall, the turns topic and the holders route (FC 6, 7, 10)", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const controls = upstreamControls();
  /** The upstream's answer while a test holds it (`controls.hold`), else the plain reply. @type {((call: any) => any) | null} */
  let scripted = null;
  const SYS = { role: "system", content: "You help." };
  const person = (text) => ({ role: "user", content: [{ type: "text", text }] });
  const replyText = (m) =>
    Array.isArray(m?.content) ? m.content.filter((b) => b?.type === "text").map((b) => b.text).join("") : String(m?.content ?? "");

  before(async () => {
    up = await fakeUpstream((call) => (scripted ? scripted(call) : anthropicReply("a reply from the model", { model: "m-1" })));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        // The brain's autopilot decides what recall puts into the window (FC 7 needs it deciding).
        cfg.memory.autopilot.enabled = true;
        // One memory the recall always finds, so "nothing recalled" is a real difference (FC 7). The state
        // file was written by startApp; the sidecar reads it when the engine client first starts it.
        try {
          writeFileSync(join(shim_dataDirArg(cfg), "fake-engine-state.json"), JSON.stringify({
            memories: [{ id: "m1", content: "the launch passphrase is alpha-tango", importance: 0.9, fixedScore: 0.9 }],
            canonical: [],
            seq: 1,
          }));
        } catch {}
        process.env.FAKE_SIDECAR_RECALL_ALL = "1";
      },
    });
  });
  /** The data dir from the config (configure runs before the app exists). @param {any} cfg */
  function shim_dataDirArg(cfg) {
    return cfg.memory.folder ? cfg.memory.folder.replace(/([\\/])mem$/, "$1") : ".";
  }
  after(async () => {
    controls.letGo();
    delete process.env.FAKE_SIDECAR_RECALL_ALL;
    await shim.stop();
    await up.close();
    try { rmSync(shim.dataDir, { recursive: true, force: true }); } catch {}
  });

  /** @param {string} sid */
  const chainOf = (sid) => /** @type {any} */ (shim.app.memory.archive).chainIdForKey(chainKeyForConversationId(sid));
  const zcTurn = async (sid, text) => {
    const r = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person(text)] }, { "x-session-id": sid, "x-filament-cwd": process.cwd(), "user-agent": "opencode/1.2" });
    await r.text();
    return r;
  };
  /** The harness's own session, in this process's folder. */
  const harnessSession = async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: process.cwd(), model: "m-1" } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** The harness's own path: a native session turn through the sessions route. */
  const harnessTurn = async (chainId, text) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/turns`, { method: "POST", body: { content: text, stream: false } });
    await r.text();
    return r;
  };
  const recordOf = async (id) => (await (await shim.api(`/api/requests/${encodeURIComponent(id)}`)).json());

  test("the next request is composed under the chat's settings (FC 6)", async () => {
    const chainId = await harnessSession();
    // A mode knob of the chat's own, the effort — the composed request must join it onto the model name.
    const set = await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/settings`, { method: "PATCH", body: { patch: { model: { effort: "high" } } } });
    assert.equal(set.status, 200, await set.clone().text());
    // The harness's next turn composes from the session's settings: withEffort joins the chat's effort onto
    // the model name — the record keeps the wire name (the proxy strips the suffix before forwarding).
    await harnessTurn(chainId, "the settings-composed turn");
    const t = await (await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/transcript`)).json();
    const row = t.turns.find((x) => x.user && replyText(x.user).includes("the settings-composed turn"));
    assert.ok(row?.requestIds?.length, "the turn reached the pipeline");
    const rec = await recordOf(row.requestIds.at(-1));
    assert.equal(rec.model, "m-1-high", `the composed request carried the chat's effort (${rec.model})`);
    assert.equal(t.settings.sources["model.effort"], "session");
  });

  test("mute writes memory.enabled false, and the next request — the harness's in its session, OpenCode's in its own — recalls nothing (FC 7)", async () => {
    /** The turn of a session whose words are these. @param {string} chainId @param {string} words */
    const rowIn = async (chainId, words) => {
      const t = await (await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/transcript`)).json();
      return t.turns.find((x) => x.user && replyText(x.user).includes(words)) || null;
    };
    /** Before the mute, the autopilot's recall put the seeded memory into the window (the cue's data on the record). @param {string} chainId @param {string} words */
    const recalled = (chainId, words) =>
      until(async () => {
        const row = await rowIn(chainId, words);
        if (!row?.requestIds?.length) return null;
        const rec = await recordOf(row.requestIds.at(-1));
        return rec?.memory?.cue?.items > 0 || null;
      }, `the unmuted turn's recall reached the record (${words})`);
    /** @param {string} chainId */
    const mute = async (chainId) => {
      const muted = await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/settings`, { method: "PATCH", body: { patch: { memory: { enabled: false } } } });
      assert.equal(muted.status, 200);
      const doc = await (await shim.api(`/api/sessions/${encodeURIComponent(chainId)}/settings`)).json();
      assert.equal(doc.effective.memory.enabled, false, "the setting is in force");
    };
    // The harness's own next request recalls nothing — no cue, nothing injected.
    const own = await harnessSession();
    await harnessTurn(own, "warm the harness's session");
    await recalled(own, "warm the harness's session");
    await mute(own);
    await harnessTurn(own, "the harness turn after the mute");
    const harnessRow = await rowIn(own, "the harness turn after the mute");
    assert.ok(harnessRow, "the harness turn is on the transcript");
    const harnessRec = harnessRow.requestIds?.length ? await recordOf(harnessRow.requestIds.at(-1)) : null;
    assert.ok(harnessRec, "the harness turn's record exists");
    assert.equal(harnessRec.memory?.injected || 0, 0, "the muted session's harness request got nothing injected");
    assert.equal(harnessRec.memory?.cue?.items || 0, 0, "and no cue was placed for it");
    // And so does an outside client's, in its session.
    const sid = "fc-mute";
    await zcTurn(sid, "warm the muted session");
    const chainId = chainOf(sid);
    await recalled(chainId, "warm the muted session");
    await mute(chainId);
    const rowOf = (/** @type {string} */ words) => rowIn(chainId, words);
    await zcTurn(sid, "the opencode turn after the mute");
    const zcRow = await rowOf("the opencode turn after the mute");
    const zcRec = zcRow?.requestIds?.length ? await recordOf(zcRow.requestIds.at(-1)) : null;
    assert.ok(zcRec, "the outside turn's record exists");
    assert.equal(zcRec.memory?.injected || 0, 0, "the muted session's outside request got nothing injected");
    assert.equal(zcRec.memory?.cue?.items || 0, 0, "and no cue was placed for it either");
  });

  // (fails before: yes, on its last assertion — an outside client's turn took no lock, and nothing said its end on the
  // `turns` topic)
  test("a holder change publishes on turns, /api/events carries it, and the holders route lists and clears it; an outside client's turn says its end alone there, with no holder (FC 10)", async () => {
    // Subscribed BEFORE any turn: the warm turn's whole cycle (acquire → release) rides this stream, so the
    // topic's path is proven on it before the held turn is staged.
    const res = await shim.api("/api/events");
    assert.equal(res.status, 200);
    const events = readEvents(res);
    const chainId = await harnessSession();
    /** The topic's word on a chat, a holder or its release. @param {string} chain @param {boolean} held */
    const said = (chain, held) => events.events.some((e) => e.data?.type === "turn" && e.data.chainId === chain && !!e.data.holder === held);
    await harnessTurn(chainId, "warm the topic session");
    await until(() => said(chainId, false) || null, "the warm turn's release on the turns topic");
    // A held turn: its request waits at the upstream while the lock holds the chat.
    const held = controls.hold(anthropicReply("the held reply", { model: "m-1" }));
    scripted = held.script;
    try {
      const turnPromise = harnessTurn(chainId, "the held turn");
      await held.arrived;
      const r = await (await shim.api("/api/sessions/holders")).json();
      const row = (r.holders || []).find((/** @type {any} */ h) => h.chainId === chainId) || null;
      assert.deepEqual([row?.label, row?.client, row?.window], ["the harness", "harness", "harness"], "the holder's words ride the route (D13), the client id and the window beside them");
      await until(() => said(chainId, true) || null, "the turns topic carried the holder");
      const turnMsg = /** @type {any} */ (events.events.find((e) => e.data?.type === "turn" && e.data.chainId === chainId && e.data.holder));
      assert.equal(turnMsg.data.holder.label, "the harness");
      held.release();
      await turnPromise;
    } finally {
      scripted = null;
    }
    await until(async () => {
      const again = await (await shim.api("/api/sessions/holders")).json();
      return (again.holders || []).some((/** @type {any} */ h) => h.chainId === chainId) ? null : true;
    }, "the finished turn leaves the holders route");
    // An outside client's turn holds no chat: the topic says its end alone, with no holder. The harness turn after it,
    // heard released, is the stream's word that everything said before it has arrived.
    const sid = "fc-topic";
    await zcTurn(sid, "an outside turn");
    const before = events.events.length;
    await harnessTurn(chainId, "after the outside turn");
    await until(() => events.events.slice(before).some((e) => e.data?.type === "turn" && e.data.chainId === chainId && e.data.holder === null) || null, "the next harness turn's release");
    assert.ok(chainOf(sid), "the client's chat is on record");
    assert.deepEqual(
      events.events.filter((e) => e.data?.type === "turn" && e.data.chainId === chainOf(sid)).map((e) => e.data.holder),
      [null],
      "the client's turn: its end alone, no holder",
    );
    await events.stop();
  });

  // (fails before: yes — an outside client's turn took no lock, and nothing said its end: the page heard nothing of it,
  // its sidebar's list did not move and a chat it keeps was not marked unseen)
  test("an outside client's turn says its end on the turns topic, with no holder: a reply that calls a tool says nothing, the leg that ends the loop does (FC 10)", async () => {
    const res = await shim.api("/api/events");
    const events = readEvents(res);
    const sid = "fc-ended";
    const zc = { "x-session-id": sid, "x-filament-cwd": process.cwd(), "user-agent": "opencode/1.2" };
    /** What the topic said of the client's chat, holder by holder. */
    const said = () => events.events.filter((e) => e.data?.type === "turn" && e.data.chainId === chainOf(sid)).map((e) => e.data.holder);
    /** The harness's turn, heard released: the stream's word that everything said before it has arrived. */
    const heard = async () => {
      const chainId = await harnessSession();
      const before = events.events.length;
      await harnessTurn(chainId, "a marker");
      await until(() => events.events.slice(before).some((e) => e.data?.type === "turn" && e.data.chainId === chainId && e.data.holder === null) || null, "the harness turn's release");
    };
    const call = { type: "tool_use", id: "t1", name: "Read", input: { path: "notes.md" } };
    const asked = [SYS, person("read my notes")];
    try {
      scripted = () => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [call] });
      const first = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: asked }, zc);
      assert.equal(first.status, 200, await first.clone().text());
      assert.equal((await first.json()).stop_reason, "tool_use");
      scripted = null;
      await heard();
      assert.ok(chainOf(sid), "the client's chat is on record");
      assert.deepEqual(said(), [], "a reply that calls a tool: the loop waits on it, and nothing is said");
      // The leg: the tool's result; the reply to it ends the loop, and the turn
      const leg = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [...asked, { role: "assistant", content: [call] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "the notes" }] }] }, zc);
      assert.equal(leg.status, 200, await leg.clone().text());
      await leg.text();
      await until(() => said().length || null, "the client's turn's end on the turns topic");
      await heard();
      assert.deepEqual(said(), [null], "its end, once, with no holder");
    } finally {
      scripted = null;
      await events.stop();
    }
  });

  // (fails before: yes — a client's chat that ended a turn wrote nothing in its project's What happened: only a lock's
  // letting go reached it, and a client's chat holds no lock)
  test("an outside client's chat that ends a turn writes its line in its project's What happened", async () => {
    const folder = mkdtempSync(join(tmpdir(), "filament-fc-news-"));
    try {
      const sid = "fc-news";
      const zc = { "x-session-id": sid, "x-filament-cwd": folder, "user-agent": "opencode/1.2" };
      const first = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("start the news")] }, zc);
      await first.text();
      const chainId = chainOf(sid);
      const project = /** @type {any} */ (shim.app.memory.archive).getChain(chainId)?.project_id;
      assert.ok(project && project !== "none", `the client's chat is in its folder's project (${project})`);
      const made = await shim.api(`/api/space/${encodeURIComponent(project)}`, { method: "POST", body: {} });
      assert.equal(made.status, 200, await made.clone().text());
      const second = await shim.post("/v1/messages", { model: "m-1", max_tokens: 100, messages: [SYS, person("start the news"), { role: "assistant", content: "a reply from the model" }, person("and now the second turn")] }, zc);
      await second.text();
      const line = await until(async () => {
        const space = await (await shim.api(`/api/space/${encodeURIComponent(project)}`)).json();
        return (space.log || []).find((/** @type {any} */ e) => e.by?.kind === "filament" && e.by?.chain === chainId) || null;
      }, "the chat's line in its project's What happened");
      assert.match(line.text, /finished a turn/);
    } finally {
      await removeDirs(folder);
    }
  });

  test("the dashboard's stream handler skips the turn messages (it reads op and record only) (FC 10)", () => {
    // Structural: the dashboard ignores messages without op/record — the turn messages carry neither.
    const src = readFileSync(new URL("../src/ui/app.js", import.meta.url), "utf8");
    const at = src.indexOf("es.onmessage");
    const body = src.slice(at, src.indexOf("};", at));
    assert.match(body, /ev\?\.op/, "op messages are handled");
    assert.match(body, /if \(!ev\?\.record\) return;/, "everything without a record is ignored — the turn messages carry neither");
    assert.equal(/"turn"/.test(body), false, "no turn branch — the message falls through, ignored");
  });
});
