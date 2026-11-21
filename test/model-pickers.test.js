// @ts-check
// Every model choice is the composer's model picker (the owner's of 10-28: "anywhere in the harness where model picker
// is used, have it use our standard model picker we have and not just a list of all the models"). The flow box's Runs
// on (test/flow-page.test.js) and the message box's `/` list: no rows of `agent/<model>` ids any more, one row, Change
// the model…, that opens the box's picker on the words typed (the Designer's of 10-28).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

const settle = () => new Promise((r) => setTimeout(r, 10));

// The page's API client keeps the `fetch` it finds when it is first imported: the stand-in goes first.
const g = /** @type {any} */ (globalThis);
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => ({
  ok: true, status: 200,
  json: async () => (String(url).startsWith("/api/commands") ? { groups: [{ title: "In any chat", commands: [{ command: "/status", summary: "The chat's state" }] }] } : {}),
});
const { createSlashPanel, modelRow } = await import("../src/ui/harness/composer/slash.js");
const { createModelSelect } = await import("../src/ui/harness/composer/model.js");
after(() => { g.fetch = realFetch; });

const MODELS = [{ id: "claude-opus-5-5", upstream: "anthropic" }, { id: "glm-5.3", upstream: "zai" }];

// (fails before: yes — the / list listed up to 8 rows of agent/<model> ids, a pick switching the model at once)
test("the / list's way to the model: one row, last, with nothing typed, with words of \"model\", or words the picker finds a model for", () => {
  const cb = { onOpenModel: () => {}, modelMatches: (/** @type {string} */ q) => ["opus", "glm"].includes(q), modelKey: () => "Ctrl+M" };
  assert.deepEqual(modelRow(cb, ""), [{ section: "Model", kind: "model", label: "Change the model…", insert: "", picker: "", detail: "Opens the model picker · Ctrl+M" }]);
  assert.equal(modelRow(cb, "mod")[0]?.picker, "", "words of \"model\": the picker opens unsearched");
  assert.deepEqual(modelRow(cb, "Opus").map((r) => [r.picker, r.detail]), [["Opus", "Opens the model picker on “Opus”"]]);
  assert.deepEqual(modelRow(cb, "status"), [], "words that find no model: no row");
  assert.deepEqual(modelRow({}, ""), [], "a panel with no picker to open: none");
});

describe("the / panel and the box's picker", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => { doc = stubDocument(); });
  after(() => { doc.restore(); });

  test("/opus: no list of models; Change the model… takes the typed word away and opens the picker on it", async () => {
    /** @type {any[][]} */
    const calls = [];
    const panel = createSlashPanel({
      onInsert: (text) => calls.push(["insert", text]),
      onOpenModel: (q) => calls.push(["picker", q]),
      modelMatches: (q) => q === "opus",
    });
    await panel.open("/", "opus");
    await settle();
    const rows = /** @type {any[]} */ (panel.el.querySelectorAll(".slash-row"));
    assert.deepEqual(rows.map((r) => r.querySelector(".slash-label")?.textContent), ["Change the model…"], "no agent/ ids, no model names");
    assert.equal(panel.el.querySelector(".slash-head-title")?.textContent, "opus");
    rows[0].dispatch("click");
    assert.deepEqual(calls, [["insert", ""], ["picker", "opus"]]);
    assert.equal(panel.isOpen(), false);
    await panel.open("/", "");
    await settle();
    const all = /** @type {any[]} */ (panel.el.querySelectorAll(".slash-row")).map((r) => r.querySelector(".slash-label")?.textContent);
    assert.deepEqual(all, ["/status", "Change the model…"], "nothing typed: the commands, then the row, last");
    assert.equal(panel.el.querySelector(".slash-head-title")?.textContent, "Commands");
  });

  // (fails before: yes — the picker opened only on the model in force, and had no word for what its search finds)
  test("the picker says whether words find a model, and opens on them, their first match highlighted; closed, the focus goes back", () => {
    /** @type {string[]} */
    const picked = [];
    const sel = createModelSelect({ onChange: (name) => picked.push(name) });
    sel.setModels(MODELS);
    sel.set("claude-opus-5-5");
    assert.equal(sel.matches("glm"), true);
    assert.equal(sel.matches("OPUS"), true);
    assert.equal(sel.matches("nothing-like-it"), false);
    assert.equal(sel.matches(""), false);
    let closed = 0;
    sel.open("glm", { onClose: () => { closed++; } });
    const search = /** @type {any} */ (doc.document.querySelector(".mp-search-input"));
    assert.equal(search?.value, "glm", "its words already in the search");
    const hi = /** @type {any[]} */ (doc.document.querySelectorAll(".mp-row")).filter((r) => r.classList.contains("is-hi"));
    assert.equal(hi.length, 1);
    assert.match(String(hi[0].getAttribute("title")), /glm-5\.3/, "the first match, not the model in force");
    hi[0].dispatch("click");
    assert.deepEqual(picked, ["glm-5.3"]);
    assert.equal(closed, 1, "the box has the focus again");
  });
});
