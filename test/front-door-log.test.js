// @ts-check
// The front door's log lines name no address that opens something: an agent's MCP door (`/mcp/<token>`), a connector's
// (`/mcp/c/<signed>`), an app's hook (`/hook/<app>/<token>`) and a watcher's address (`/watch/<token>`) are said
// without the part that opens them. The log is a file an agent can read, and an agent that read its watcher's address
// there could wake itself.
// (fails before: yes — `unhandled error in POST /hook/Deploys/<token>` and `blocked POST /watch/<token> from an
// artifact's page` stood in the log, token and all; `pathShown` was not there)
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { defaultConfig } from "../src/config.js";
import { createFrontDoor, pathShown } from "../src/http/front-door.js";

const TOKEN = "0123456789abcdef0123456789abcdef";
/** @type {(() => Promise<void>)[]} */
const closing = [];
after(async () => {
  for (const close of closing) await close();
});

/** A front door whose token doors all throw, with what it logged. */
async function door() {
  /** @type {string[]} */
  const logs = [];
  const cfg = defaultConfig();
  const boom = async () => {
    throw new Error("aborted");
  };
  const front = createFrontDoor(
    /** @type {any} */ ({
      config: { get: () => cfg },
      log: (/** @type {string} */ level, /** @type {string} */ msg) => void logs.push(`${level} ${msg}`),
      deps: {},
      pipeline: { handle: async (/** @type {any} */ _req, /** @type {any} */ res) => res.writeHead(200).end("{}") },
      responsesDoor: {},
      mcp: { refuseUnknown: () => false, handle: boom },
      connectors: { handle: boom },
      memoryMcp: { handle: boom },
      admin: async (/** @type {any} */ _req, /** @type {any} */ res) => res.writeHead(200).end("{}"),
      artifacts: async () => {},
      hooks: boom,
      watchHooks: boom,
      isDraining: () => false,
      VERSION: "test",
      startedAt: 0,
    }),
  );
  const server = http.createServer(front);
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  closing.push(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(() => r(undefined)));
  });
  return {
    logs,
    /** @param {string} path @param {Record<string, string>} [headers] */
    post: (path, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" }),
  };
}

describe("the front door's log", () => {
  test("pathShown: an address that opens something is said without the part that opens it; every other path whole", () => {
    assert.equal(pathShown(`/watch/${TOKEN}`), "/watch/…");
    assert.equal(pathShown(`/watch/${TOKEN}/more`), "/watch/…");
    assert.equal(pathShown(`/hook/Deploys/${TOKEN}`), "/hook/Deploys/…");
    assert.equal(pathShown(`/hook/Deploys/${TOKEN}/x`), "/hook/Deploys/…");
    assert.equal(pathShown(`/mcp/${TOKEN}`), "/mcp/…");
    assert.equal(pathShown(`/mcp/${TOKEN}/sse`), "/mcp/…");
    assert.equal(pathShown(`/mcp/c/abc.def.${TOKEN}`), "/mcp/c/…");
    // Memory's door has no token: it is a name.
    assert.equal(pathShown("/mcp/memory"), "/mcp/memory");
    // (fails before: yes — the hunt on x41: an artifact's pass stood in the log whole, and it opens that artifact)
    assert.equal(pathShown("/~abc_1.def-2/index.html"), "/~…/index.html");
    assert.equal(pathShown("/~abc.def"), "/~…");
    assert.equal(pathShown("/spend-k3f9/~abc.def/data"), "/spend-k3f9/~…/data", "the network's, after its artifact's name");
    assert.equal(pathShown("/~home/x"), "/~home/x", "a path with no pass in it, whole");
    for (const p of ["/", "/api/space/p1/routines/r1/address", "/v1/messages", "/hook", "/hook/Deploys", "/watch", "/mcp", "/ui/harness.html", "/watcher/x"]) assert.equal(pathShown(p), p, p);
  });

  test("a token door that throws is logged by its door, never by its token", async () => {
    const d = await door();
    for (const path of [`/watch/${TOKEN}`, `/hook/Deploys/${TOKEN}`, `/mcp/${TOKEN}`, `/mcp/c/sig.${TOKEN}`]) {
      const r = await d.post(path);
      assert.equal(r.status, 500, path);
      await r.text();
    }
    assert.equal(d.logs.length, 4, d.logs.join("\n"));
    for (const line of d.logs) assert.ok(!line.includes(TOKEN), line.slice(0, 200));
    assert.ok(d.logs[0].startsWith("error unhandled error in POST /watch/…: "), d.logs[0].slice(0, 120));
    assert.ok(d.logs[1].startsWith("error unhandled error in POST /hook/Deploys/…: "), d.logs[1].slice(0, 120));
    assert.ok(d.logs[2].startsWith("error unhandled error in POST /mcp/…: "), d.logs[2].slice(0, 120));
    assert.ok(d.logs[3].startsWith("error unhandled error in POST /mcp/c/…: "), d.logs[3].slice(0, 120));
  });

  test("a request an artifact's page sent to a token door is refused, and logged without the token", async () => {
    const d = await door();
    for (const path of [`/watch/${TOKEN}`, `/hook/Deploys/${TOKEN}`, `/mcp/${TOKEN}`]) {
      const r = await d.post(path, { origin: "http://notes.art.localhost:4010" });
      assert.equal(r.status, 403, path);
      await r.text();
    }
    assert.equal(d.logs.length, 3, d.logs.join("\n"));
    for (const line of d.logs) assert.ok(!line.includes(TOKEN), line.slice(0, 200));
    assert.equal(d.logs[0], "warn blocked POST /watch/… from an artifact's page (http://notes.art.localhost:4010)");
  });
});
