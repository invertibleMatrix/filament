// A view-only device's console (the old settings UI at `/`) asks no write of the server either: the gate is the shared
// client's (ui/lib/api.js), the harness's and the console's one place (the review of p4-view-ui, fx-view-console).
// (fails before: yes — a view-only device's console never opened: its boot read the templates, which the server
// refuses that device, and it stood "Filament is not answering", retrying every 5 seconds; its client sent every write,
// and the server's refusal reached its page in the server's words; the Assistant's and the Lab's requests went past
// the client. Checked in Electron 45 against a throwaway Filament over its network listener, paired view-only.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("every client the pages make asks no write on a view-only device's page, in the page's words", async () => {
  const { createApi, setViewOnly, viewOnlyNow, VIEW_ONLY_REFUSED } = await import("../src/ui/lib/api.js");
  /** @type {string[]} */
  const asked = [];
  const fetchImpl = async (url, init) => {
    asked.push(`${init?.method || "GET"} ${url}`);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const one = createApi({ fetchImpl });
  const other = createApi({ base: "/elsewhere", headers: { "x-filament-tab": "t1" }, fetchImpl });
  try {
    setViewOnly(true);
    assert.equal(viewOnlyNow(), true);
    for (const client of [one, other]) {
      for (const [method, path] of [["POST", "/config"], ["PUT", "/config"], ["DELETE", "/keys/k1"], ["PATCH", "/sessions/c1"], ["HEAD", "/state"], ["post", "/assistant/reset"], ["POST", "/remote/sign-out/x"]]) {
        await assert.rejects(client(path, { method, body: {} }), (e) => {
          assert.equal(e.message, VIEW_ONLY_REFUSED, `${method} ${path}`);
          assert.equal(e.status, 403);
          assert.equal(e.body.viewOnly, true);
          return true;
        });
      }
    }
    assert.deepEqual(asked, [], "nothing asked of the server");
    assert.deepEqual(await one("/state"), { ok: true });
    assert.deepEqual(await other("/sessions?x=1", { method: "get" }), { ok: true });
    assert.deepEqual(await one("/remote/sign-out", { method: "POST" }), { ok: true });
    assert.deepEqual(await one("/remote/sign-out?then=pair", { method: "POST" }), { ok: true });
    assert.deepEqual(asked, ["GET /api/state", "get /elsewhere/sessions?x=1", "POST /api/remote/sign-out", "POST /api/remote/sign-out?then=pair"], "a GET and the device's own sign-out go");
    setViewOnly(false);
    assert.equal(viewOnlyNow(), false);
    assert.deepEqual(await one("/config", { method: "PUT", body: { a: 1 } }), { ok: true }, "a full page's write goes");
    assert.equal(asked.at(-1), "PUT /api/config");
    setViewOnly(/** @type {any} */ ("yes"));
    assert.equal(viewOnlyNow(), false, "only true turns it on");
  } finally {
    setViewOnly(false);
  }
});

test("/api/state's device says whether the page reads alone", async () => {
  const { viewOnlyOf } = await import("../src/ui/lib/api.js");
  assert.equal(viewOnlyOf({ device: { id: "d1", name: "Phone", scope: "view" } }), true);
  assert.equal(viewOnlyOf({ device: { id: "d2", name: "Laptop", scope: "full" } }), false);
  assert.equal(viewOnlyOf({ device: null }), false, "this computer's page");
  assert.equal(viewOnlyOf({}), false);
  assert.equal(viewOnlyOf(undefined), false);
});

test("the harness's client keeps no gate of its own: it sets the shared one", async () => {
  const harness = await import("../src/ui/harness/lib/api.js");
  const shared = await import("../src/ui/lib/api.js");
  assert.equal(harness.VIEW_ONLY_REFUSED, shared.VIEW_ONLY_REFUSED);
  try {
    harness.setViewOnlyApi(true);
    assert.equal(shared.viewOnlyNow(), true, "the harness's page turns on the one gate");
    harness.setViewOnlyApi(false);
    assert.equal(shared.viewOnlyNow(), false);
  } finally {
    shared.setViewOnly(false);
  }
  const src = read("../src/ui/harness/lib/api.js");
  assert.doesNotMatch(src, /viewAsks|let viewOnly/, "one place");
});

test("the console sets the gate wherever it reads /api/state, and its streams' writes ask it", () => {
  const app = read("../src/ui/app.js");
  assert.match(app, /import \{ api, setViewOnly, viewOnlyNow, viewOnlyOf \} from "\.\/lib\/api\.js";/);
  assert.match(app, /starts\.set\(start\);\n(?:  \/\/[^\n]*\n)+  setViewOnly\(viewOnlyOf\(st\)\);\n[^\n]*\n  state\.config = st\.config; state\.saved/, "as it boots");
  assert.match(app, /const st = await api\("\/state"\);\n    setViewOnly\(viewOnlyOf\(st\)\);\n    if \(state\.dirty \|\| drawerHolds\(\)\) return null;/, "as another window's save is read");
  assert.match(app, /api\("\/state"\)\.then\(\(st\) => \{ setViewOnly\(viewOnlyOf\(st\)\); configFollow\.heard\(st\.configVersion\); \}, \(\) => \{\}\);/, "as the stream opens again");
  // It opens at all: the templates it may not read are none, where the console stood "not answering", retrying every
  // 5 seconds; then no Save changes, and its status line says what it is.
  assert.match(app, /api\("\/templates"\)\.catch\(\(e\) => \{ if \(e\?\.status === 403\) return \{ templates: \[\] \}; throw e; \}\)/, "a refused read of the templates is none");
  assert.match(app, /setViewOnly\(viewOnlyOf\(st\)\);\n  \$\("#config-actions"\)\.classList\.toggle\("hidden", viewOnlyNow\(\)\);/, "no Save changes");
  assert.match(app, /setStatus\("ok", `Running on port \$\{st\.config\.server\.port\}\$\{viewOnlyNow\(\) \? " · view-only: this device changes nothing" : ""\}`\);/);
  assert.match(app, /`Running on port \$\{state\.meta\.port\} · live\$\{viewOnlyNow\(\) \? " · view-only: this device changes nothing" : ""\}`/, "and as its stream opens");
  const assistant = read("../src/ui/pages/assistant.js");
  assert.match(assistant, /const send = async \(text\) => \{\n      if \(!text\.trim\(\)\) return;\n[^\n]*\n      if \(viewOnlyNow\(\)\) \{ toast\(VIEW_ONLY_REFUSED, "err"\); return; \}/, "the Assistant's message");
  assert.ok(assistant.indexOf("if (viewOnlyNow())") < assistant.indexOf('fetch("/api/assistant/chat"'));
  const lab = read("../src/ui/pages/lab.js");
  assert.match(lab, /const send = async \(\) => \{\n[^\n]*\n      if \(viewOnlyNow\(\)\) return toast\(VIEW_ONLY_REFUSED, "err"\);\n      const r = buildRequest\(\);/, "the Lab's request");
});

// (fails before: yes — the review of fx-view-console: an edit on a view-only console marked it unsaved, which held
// every live redraw back with no Discard to undo it; New chat and Run dry run, refused, said nothing; Download CSV on
// Usage put the server's refusal in the console's place)
test("a view-only console holds no edit back, says each refusal, and downloads the usage it reads", async () => {
  const app = read("../src/ui/app.js");
  assert.match(app, /function markDirty\(v = true\) \{ if \(v && viewOnlyNow\(\)\) return; state\.dirty = v;/, "never unsaved");
  assert.match(read("../src/ui/pages/assistant.js"), /onclick: async \(\) => \{ let r; try \{ r = await api\("\/assistant\/reset", \{ method: "POST", body: \{ sessionId: A\.sessionId \} \}\); \} catch \(\/\*\* @type \{any\} \*\/ e\) \{ return toast\(e\.message, "err"\); \}/, "New chat");
  assert.match(read("../src/ui/pages/lab.js"), /let r; try \{ r = await api\("\/dry-run", \{ method: "POST", body: \{ format: fmtSel\.value, body, headers \} \}\); \} catch \(\/\*\* @type \{any\} \*\/ e\) \{ return toast\(e\.message, "err"\); \}/, "Run dry run");
  const { viewReads } = await import("../src/http/admin/remote.js");
  assert.equal(viewReads("GET", "/usage/days.csv"), true, "the days it reads, as a file");
  assert.equal(viewReads("GET", "/usage/days"), true);
});
