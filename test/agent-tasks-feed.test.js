// @ts-check
// A coding agent's task list on the events feed (HarnessV4_Tasks U1; server.js `tasksOnFeed`). Its bridge says the whole
// list at every change — each `task_progress` of a running sub-agent among them, many a second — and the feed every
// page holds carries a chat's list at most once each half second, as a sub-agent's progress goes (HarnessV3-Views V3):
// the first at once, and the newest always, at the end of the half second that held it. The bridge is a real
// Filament's, told by hand.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "./helpers/app.js";
import { until, readEvents } from "./helpers/wait.js";

/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
before(async () => {
  shim = await startApp({});
});
after(async () => {
  await shim.stop();
});

/** A list as the bridge says it: a sub-agent's task, `tokens` into its work. @param {number} tokens */
const listAt = (tokens) => [{ id: "t1", kind: "local_agent", description: "Find hello", background: false, tokens }];

// (fails before: yes — on c97b98c59 every list the bridge said went onto every page's events feed as it came: a busy
// sub-agent's progress, many a second, to each page open)
test("a burst of a chat's task lists reaches the feed as its first at once and its newest after; another chat's goes as its own", async () => {
  const acp = /** @type {any} */ (shim.app).acp;
  const feed = readEvents(await shim.api("/api/events"));
  try {
    await until(() => feed.events.some((e) => e.data?.type === "hello"), "the feed to open");
    /** The lists the feed said for a chat, each as its task's tokens, or "none" for an empty one. @param {string} chain */
    const said = (chain) => feed.events.filter((e) => e.data?.type === "agent-tasks" && e.data.chainId === chain).map((e) => e.data.tasks[0]?.tokens ?? "none");
    for (let n = 1; n <= 20; n++) acp.onTasks({ chain: "chat-a", sessionId: "agent-a", tasks: listAt(n * 100) });
    acp.onTasks({ chain: "chat-b", sessionId: "agent-b", tasks: listAt(7) });
    // The sub-agent ended: the list's end is the newest word.
    acp.onTasks({ chain: "chat-a", sessionId: "agent-a", tasks: [] });
    await until(() => said("chat-a").at(-1) === "none", "the newest list on the feed");
    assert.deepEqual(said("chat-a"), [100, "none"], "the first at once, the newest once its half second is over");
    assert.deepEqual(said("chat-b"), [7], "another chat's list: at once, its own");
    const last = feed.events.filter((e) => e.data?.type === "agent-tasks" && e.data.chainId === "chat-a").at(-1)?.data;
    assert.deepEqual(last, { type: "agent-tasks", chainId: "chat-a", sessionId: "agent-a", tasks: [] }, "said whole, with the chat's id");
  } finally {
    await feed.stop();
  }
});
