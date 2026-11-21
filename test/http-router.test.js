// @ts-check
// The route table (http/router.js): its contract is pinned here so the front door and the admin areas can rely on it —
// first row wins, `:name` is exactly one segment, `:name*` is one or more (a greedy tail), empty segments are kept on
// both sides, and params arrive as the URL spelled them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../src/http/router.js";

/** @param {string} name */
const h = (name) => Object.assign(() => name, { routeName: name });
/** @param {ReturnType<typeof createRouter>} route @param {string} method @param {string} path */
const hit = (route, method, path) => {
  const m = route(method, path);
  return m ? { name: /** @type {any} */ (m.handler).routeName, params: m.params } : null;
};

test("a literal row answers its exact path and method only", () => {
  const route = createRouter([
    ["GET", "/state", h("state")],
    ["POST", "/shutdown", h("shutdown")],
  ]);
  assert.deepEqual(hit(route, "GET", "/state"), { name: "state", params: {} });
  assert.equal(hit(route, "POST", "/state"), null, "the method is part of the row");
  assert.equal(hit(route, "GET", "/state/x"), null, "a literal row is not a prefix");
  assert.equal(hit(route, "GET", "/stat"), null);
  assert.equal(
    hit(route, "GET", "/state/"),
    null,
    "a trailing slash is an extra empty segment; the caller strips it",
  );
  assert.equal(hit(route, "GET", "//state"), null, "an empty segment before the literal does not match it");
});

test("`:name` takes exactly one segment, as the URL spelled it", () => {
  const route = createRouter([
    ["POST", "/requests/:id/cancel", h("cancel")],
    ["GET", "/templates/:id/:action", h("template")],
  ]);
  assert.deepEqual(hit(route, "POST", "/requests/abc/cancel"), { name: "cancel", params: { id: "abc" } });
  assert.deepEqual(hit(route, "POST", "/requests/a%2Fb/cancel"), { name: "cancel", params: { id: "a%2Fb" } });
  assert.deepEqual(hit(route, "POST", "/requests//cancel"), { name: "cancel", params: { id: "" } });
  assert.equal(hit(route, "POST", "/requests/a/b/cancel"), null, "two segments are not one");
  assert.equal(hit(route, "POST", "/requests/abc"), null, "the literal after the param is required");
  assert.deepEqual(hit(route, "GET", "/templates/t1/apply"), {
    name: "template",
    params: { id: "t1", action: "apply" },
  });
  assert.equal(hit(route, "GET", "/templates/t1"), null);
});

test("`:name*` takes the rest — one or more segments, joined back with slashes — and literals may follow it", () => {
  const route = createRouter([
    ["GET", "/requests/:id*", h("detail")],
    ["POST", "/health/:id*/reset", h("reset")],
    ["POST", "/acp/processes/:key*/kill", h("kill")],
  ]);
  assert.deepEqual(hit(route, "GET", "/requests/abc"), { name: "detail", params: { id: "abc" } });
  assert.deepEqual(hit(route, "GET", "/requests/a/b/c"), { name: "detail", params: { id: "a/b/c" } });
  assert.deepEqual(
    hit(route, "GET", "/requests/"),
    { name: "detail", params: { id: "" } },
    "the empty tail is a tail",
  );
  assert.equal(hit(route, "GET", "/requests"), null, "no tail at all is not a match");
  assert.deepEqual(hit(route, "POST", "/health/up-1/reset"), { name: "reset", params: { id: "up-1" } });
  assert.deepEqual(hit(route, "POST", "/health/a/b/reset"), { name: "reset", params: { id: "a/b" } });
  assert.equal(hit(route, "POST", "/health/reset"), null, "the greedy part needs a segment of its own");
  assert.deepEqual(hit(route, "POST", "/acp/processes//kill"), { name: "kill", params: { key: "" } });
  assert.equal(hit(route, "POST", "/health/up-1/reset/extra"), null, "the literal after the tail is the end");
});

test("rows are tried in order and the first match wins", () => {
  const route = createRouter([
    ["POST", "/requests/:id/cancel", h("cancel")],
    ["GET", "/requests/:id/replays", h("replays")],
    ["GET", "/requests/:id*", h("detail")],
    ["GET", "/upstreams/test", h("test-literal")],
    ["GET", "/upstreams/:id/test", h("test-one")],
  ]);
  assert.equal(hit(route, "GET", "/requests/x/replays")?.name, "replays", "the specific row is listed first");
  assert.equal(
    hit(route, "GET", "/requests/x/cancel")?.name,
    "detail",
    "a POST-only row does not shadow a GET",
  );
  assert.equal(hit(route, "GET", "/upstreams/test")?.name, "test-literal");
  assert.deepEqual(hit(route, "GET", "/upstreams/u1/test"), { name: "test-one", params: { id: "u1" } });
  const reversed = createRouter([
    ["GET", "/requests/:id*", h("detail")],
    ["GET", "/requests/:id/replays", h("replays")],
  ]);
  assert.equal(
    hit(reversed, "GET", "/requests/x/replays")?.name,
    "detail",
    "a greedy row listed first swallows it",
  );
});

test("method `*` answers any method; no row at all answers null", () => {
  const route = createRouter([["*", "/api/:rest*", h("admin")]]);
  for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
    assert.deepEqual(hit(route, method, "/api/state"), { name: "admin", params: { rest: "state" } }, method);
  assert.equal(hit(route, "GET", "/api"), null, "`/api` without a tail is not the admin surface");
  assert.equal(hit(route, "GET", "/v1/messages"), null);
  assert.equal(createRouter([])("GET", "/"), null);
});

test("the root path is a row like any other", () => {
  const route = createRouter([
    ["GET", "/", h("index")],
    ["GET", "/ui", h("ui")],
    ["GET", "/ui/:rest*", h("ui-file")],
  ]);
  assert.deepEqual(hit(route, "GET", "/"), { name: "index", params: {} });
  assert.deepEqual(hit(route, "GET", "/ui"), { name: "ui", params: {} });
  assert.deepEqual(hit(route, "GET", "/ui/app.js"), { name: "ui-file", params: { rest: "app.js" } });
  assert.deepEqual(hit(route, "GET", "/ui/lib/dom.js"), { name: "ui-file", params: { rest: "lib/dom.js" } });
});
