// An outside client's history goes to its provider as the client sent it: Filament folds none of its turns, and the
// request's record says what it carried.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startApp, fakeUpstream } from "./helpers/app.js";

/** Three finished turns of tool work and a live one, as a coding client resends them. @param {number} turns */
const convo = (turns) => {
  const out = [];
  for (let i = 0; i < turns; i++) {
    out.push({ role: "user", content: `turn ${i}: please fix file${i}.js` });
    out.push({ role: "assistant", content: [{ type: "thinking", thinking: `thinking about ${i} `.repeat(50), signature: "sig" }, { type: "text", text: `Looking at file${i}.js.` }, { type: "tool_use", id: `r${i}`, name: "Read", input: { file_path: `H:/proj/file${i}.js` } }] });
    out.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `r${i}`, content: `line of file${i} `.repeat(200) }] });
    if (i < turns - 1) out.push({ role: "assistant", content: [{ type: "text", text: `Fixed file${i}.js. Tests pass.` }] });
  }
  return out;
};

// (fails before: no — a guard for the owner's rules of 10-31: no choice folds an outside client's turns, so its request
// goes through with every message, and its stamp counts none folded)
test("an outside client's history goes through unchanged, and its record counts every turn whole with its composition", async () => {
  const up = await fakeUpstream();
  const shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "u", name: "u", type: "anthropic", baseUrl: up.url, apiKey: "x", enabled: true }];
      cfg.routes = [{ match: "out-*", upstream: "u", upstreamModel: "{model}", enabled: true }];
    },
  });
  try {
    const messages = convo(4);
    const r = await shim.post("/v1/messages", { model: "out-model", max_tokens: 8, system: "cwd: C:\\proj\\out", messages }, { "x-session-id": "outside-1" });
    assert.equal(r.status, 200);
    const sent = up.received.at(-1);
    assert.equal(sent.body.messages.length, messages.length, "every message went upstream");
    // Filament's own cache marks aside — the live message's, and the one on the message the request before ended at: a
    // text the client sent as a string is marked as the one block the provider reads it as.
    const unmarked = (/** @type {any} */ m) =>
      Array.isArray(m.content) && m.content.length === 1 && m.content[0].type === "text" && m.content[0].cache_control ? { ...m, content: m.content[0].text } : m;
    assert.deepEqual(sent.body.messages.slice(0, -1).map(unmarked), messages.slice(0, -1), "the finished turns as the client sent them");
    const rec = (await shim.records(20)).find((x) => x.status === "ok" && !x.local && x.view);
    assert.ok(rec, "the record carries its stamp");
    assert.equal(rec.view.totalTurns, 4, "the live turn among them");
    assert.equal(rec.view.foldedTurns ?? 0, 0, "no turn folded");
    assert.ok(rec.view.composition.toolResult > 0 && rec.view.composition.thinking > 0, "composition measured");
  } finally {
    await shim.stop();
    await up.close();
  }
});
