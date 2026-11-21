// The house key's one rule for Filament's machinery at work (services/house.js): a loop's tick or a sub-agent's call
// is never a turn — the turn gate, memory's alignment and a session's birth all ask
// `isMachineryRequest`, and only a house call can make a request one.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isMachineryRequest, admitHeaders, houseAuth, HOUSE_ONLY_HEADERS } from "../src/services/house.js";

describe("isMachineryRequest: the machinery rule's one owner", () => {
  test("a tick and a sub-agent's call are machinery; nothing else is", () => {
    for (const name of ["x-filament-agent-of", "x-filament-subagent-of"])
      assert.equal(isMachineryRequest({ [name]: "run-1" }), true, name);
    for (const name of ["x-filament-replay-of", "x-filament-housekeeping", "x-filament-memory-purpose", "x-filament-parent-request"])
      assert.equal(isMachineryRequest({ [name]: "x" }), false, `${name} is house lineage, not machinery at work`);
    assert.equal(isMachineryRequest({ "x-filament-agent-of": "" }), false, "an empty value names no run");
    assert.equal(isMachineryRequest({}), false);
    assert.equal(isMachineryRequest(null), false);
    assert.equal(isMachineryRequest(undefined), false);
  });

  test("only a house call can be machinery: a client's copy of the headers is dropped on admission", () => {
    const claimed = { "x-filament-agent-of": "run-1", "user-agent": "opencode/1.0" };
    assert.equal(isMachineryRequest(admitHeaders(claimed).headers), false, "a client cannot take itself out of the gate");
    assert.equal(isMachineryRequest(admitHeaders({ ...claimed, ...houseAuth() }).headers), true, "the house's own tick is machinery");
  });

  test("every machinery header is house-only", () => {
    for (const name of ["x-filament-agent-of", "x-filament-subagent-of"])
      assert.ok(HOUSE_ONLY_HEADERS.includes(name), name);
  });

  // HarnessV3-FixRound decision 27. (fails before: yes — the header did not exist; a client's copy would have labelled
  // its own request a Compaction fork on Traffic)
  test("only the house names a compaction fork: a client's copy of the header is dropped", () => {
    const claimed = { "x-filament-fork": "compaction", "user-agent": "opencode/1.0" };
    const admitted = admitHeaders(claimed);
    assert.equal(admitted.headers["x-filament-fork"], undefined);
    assert.deepEqual(admitted.setAside.dropped, ["x-filament-fork"]);
    assert.equal(admitHeaders({ ...claimed, ...houseAuth() }).headers["x-filament-fork"], "compaction", "the house's own fork keeps it");
  });

  // (fails before: yes — the owner's rule of 10-31: a client's `x-filament-chain` was believed, so a client could key its
  // request on a Filament chat's session and share it)
  test("only the house names the session a request belongs to: a client's x-filament-chain is dropped", () => {
    const claimed = { "x-filament-chain": "s1234567", "x-session-id": "zc-1", "user-agent": "opencode/1.0" };
    const admitted = admitHeaders(claimed);
    assert.deepEqual([admitted.headers["x-filament-chain"], admitted.headers["x-session-id"]], [undefined, "zc-1"], "its own conversation id stays");
    assert.deepEqual(admitted.setAside.dropped, ["x-filament-chain"]);
    assert.equal(admitHeaders({ ...claimed, ...houseAuth() }).headers["x-filament-chain"], "s1234567", "the house's own request keeps it");
  });

  // HarnessV3-AtHome AH-F5. (fails before: no — a guard the mutation pass asked for: nothing checked that a client can
  // neither name its call at the gate nor mark it as background work)
  test("only the house names a call at the gate or marks it background work: a client's copies are dropped", () => {
    const claimed = { "x-filament-call": "c-1", "x-filament-background": "1", "user-agent": "opencode/1.0" };
    const admitted = admitHeaders(claimed);
    assert.deepEqual([admitted.headers["x-filament-call"], admitted.headers["x-filament-background"]], [undefined, undefined]);
    assert.deepEqual(admitted.setAside.dropped, ["x-filament-call", "x-filament-background"]);
    const own = admitHeaders({ ...claimed, ...houseAuth() }).headers;
    assert.deepEqual([own["x-filament-call"], own["x-filament-background"]], ["c-1", "1"], "the house's own call keeps them");
  });

  // (fails before: yes — MEMR-5's scope: a client's `x-filament-memory-load` was believed from anyone, so a request from
  // another machine pulled any chat on this one into its own by naming it)
  test("a session named for loading is believed only from a caller that could read every session anyway", () => {
    const claimed = { "x-filament-memory-load": "c_secret:chat", "user-agent": "opencode/1.0" };
    const stranger = admitHeaders(claimed);
    assert.equal(stranger.headers["x-filament-memory-load"], undefined, "a caller that could not read every session");
    assert.deepEqual([stranger.setAside.dropped, /** @type {any} */ (stranger.setAside).unread], [[], ["x-filament-memory-load"]], "set aside, and said apart from the lineage");
    const reader = admitHeaders(claimed, /** @type {any} */ ({ reads: true }));
    assert.deepEqual([reader.headers["x-filament-memory-load"], /** @type {any} */ (reader.setAside).unread], ["c_secret:chat", []], "one that could reads it");
    assert.equal(admitHeaders({ ...claimed, ...houseAuth() }).headers["x-filament-memory-load"], "c_secret:chat", "the house's own call keeps it");
  });
});
