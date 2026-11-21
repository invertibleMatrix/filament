// @ts-check
// The fake provider the tests talk to read each chunk of a request as text of its own, so a character whose bytes two
// chunks split came out as replacement characters: a large request — a fork's, carrying the planner's prompt and
// tools — now and then differed from the planner's at an em dash, and task-graph-run's byte-for-byte test failed.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fakeUpstream } from "./helpers/app.js";

// (fails before: yes — the em dash split across two chunks read as three U+FFFD)
test("the fake provider reads a request whose chunks split a character as the one text sent", async () => {
  const up = await fakeUpstream();
  try {
    const bytes = Buffer.from(JSON.stringify({ model: "m", max_tokens: 1, messages: [{ role: "user", content: "a — b" }] }));
    const at = bytes.indexOf(Buffer.from("—")) + 1;
    await new Promise((resolve, reject) => {
      const req = http.request(`${up.url}/v1/messages`, { method: "POST", headers: { "content-type": "application/json", "content-length": bytes.length } }, (res) => {
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", reject);
      req.write(bytes.subarray(0, at));
      setTimeout(() => req.end(bytes.subarray(at)), 50);
    });
    assert.equal(/** @type {any} */ (up.received.at(-1)?.body)?.messages?.[0]?.content, "a — b");
  } finally {
    await up.close();
  }
});
