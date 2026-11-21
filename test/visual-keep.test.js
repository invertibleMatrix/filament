// @ts-check
// HarnessV4_Artifacts_Plan E18 step 5, Keep as artifact (AFC-101, AFC-102): a visual's Save menu keeps it as an
// artifact and opens it beside the chat; once kept, the same menu opens that one, never keeping it twice. The card is
// drawn in a stand-in page against a stand-in server; nothing is drawn in its frame. The route itself is
// test/artifacts.test.js's.
// (fails before: yes — a visual's Save menu held its files alone)
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** What the page asked the server, in order: its method, its address and its body. @type {[string, string, any][]} */
const asked = [];
/** What the stand-in server answers, by method and address; null leaves it unanswered. @type {(method: string, url: string) => Response | null} */
let serve = () => null;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
  const method = init?.method || "GET";
  asked.push([method, String(url), init?.body ? JSON.parse(init.body) : null]);
  return serve(method, String(url)) ?? new Promise(() => {});
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { visualCard } = await import("../src/ui/harness/conversation/visual.js");
const { chipActions } = await import("../src/ui/harness/conversation/tools/layout.js");
const { h } = await import("../src/ui/lib/dom.js");

/** @param {any} body @param {number} [status] */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const VISUAL = "/api/sessions/c1/turns/3/visuals/v1";
const LOOKUP = "/api/artifacts?chain=c1&visual=v1";

describe("Keep as artifact, from a visual's Save menu", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  };
  /** @type {string[]} */
  const opened = [];
  const openWas = chipActions.openArtifact;
  before(() => {
    doc = stubDocument();
    // A toast finds its stack on the page, and stays: nothing here takes it away.
    /** @type {any} */ (doc.document).querySelector = (/** @type {string} */ s) => doc.document.body.querySelector(s);
    g.window.setTimeout = () => 0;
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    chipActions.openArtifact = (name) => opened.push(name);
  });
  after(() => {
    chipActions.openArtifact = openWas;
    delete (/** @type {any} */ (doc.document)).querySelector;
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
    g.fetch = realFetch;
  });
  beforeEach(() => {
    asked.length = 0;
    opened.length = 0;
    doc.document.body.replaceChildren();
  });

  /** A card with its code read, and its Save button. */
  const drawn = async () => {
    const card = visualCard({ id: "v1", title: "spend_by_month" }, { onAsk: () => {}, onTell: () => {} });
    doc.document.body.append(card.el);
    card.show({ chain: "c1", n: 3 });
    const save = /** @type {any} */ (card.el).querySelector(".visual-act");
    await until(() => !save.hasAttribute("disabled"), "its code read");
    return save;
  };
  /** The menu's rows, by their first line, once it is open. */
  const rows = async () => {
    await until(() => doc.document.body.querySelector(".zc-menu"), "the menu open");
    return /** @type {any[]} */ (doc.document.body.querySelector(".zc-menu").querySelectorAll(".zc-menu-item"));
  };
  const labelOf = (/** @type {any} */ row) => (row.querySelector(".zc-menu-label-line") || row).textContent;
  const toasts = () => /** @type {any[]} */ (doc.document.body.querySelectorAll(".zc-toast")).map((t) => t.textContent);

  test("not kept yet: Keep as artifact keeps it from its turn, opens it beside the chat, and says so", async () => {
    serve = (method, url) => {
      if (url === VISUAL) return json({ title: "spend_by_month", code: "<p>spend</p>", loading: [] });
      if (url === LOOKUP) return json({ artifacts: [] });
      if (method === "POST" && url === "/api/artifacts") return json({ name: "spend-by-month-k3f9", title: "Spend by month" });
      return null;
    };
    const save = await drawn();
    assert.equal(save.getAttribute("title"), "Save it as a file, or keep it as an artifact");
    save.onclick();
    const items = await rows();
    assert.deepEqual(items.map(labelOf), ["HTML file", "Keep as artifact"]);
    items[1].dispatch("click");
    await until(() => opened.length, "opened");
    assert.deepEqual(asked.filter(([m]) => m === "POST"), [["POST", "/api/artifacts", { visual: { chain: "c1", turn: 3, id: "v1" } }]]);
    assert.deepEqual(opened, ["spend-by-month-k3f9"]);
    assert.deepEqual(toasts(), ["Kept as the artifact Spend by month, open beside the chat."]);
  });

  test("kept already: the menu opens that one; a Keep that finds one kept says it was; a refusal is said in words", async () => {
    serve = (method, url) => {
      if (url === VISUAL) return json({ title: "spend_by_month", code: "<p>spend</p>", loading: [] });
      if (url === LOOKUP) return json({ artifacts: [{ name: "spend-by-month-k3f9", title: "Spend by month" }] });
      return null;
    };
    const save = await drawn();
    save.onclick();
    const items = await rows();
    assert.deepEqual(items.map(labelOf), ["HTML file", "Open Spend by month"]);
    items[1].dispatch("click");
    assert.deepEqual(opened, ["spend-by-month-k3f9"]);
    assert.equal(asked.filter(([m]) => m === "POST").length, 0, "nothing kept again");

    // The lookup could not be asked: Keep is offered, and the server answers with the one kept.
    doc.document.body.replaceChildren();
    opened.length = 0;
    serve = (method, url) => {
      if (url === VISUAL) return json({ title: "spend_by_month", code: "<p>spend</p>", loading: [] });
      if (url === LOOKUP) return json({ error: "down" }, 500);
      if (method === "POST" && url === "/api/artifacts") return json({ name: "spend-by-month-k3f9", title: "Spend by month", already: true });
      return null;
    };
    const again = await drawn();
    again.onclick();
    const offered = await rows();
    assert.equal(labelOf(offered[1]), "Keep as artifact");
    offered[1].dispatch("click");
    await until(() => opened.length, "opened");
    assert.deepEqual(toasts(), ["Spend by month was kept already: it is open beside the chat."]);

    doc.document.body.replaceChildren();
    opened.length = 0;
    serve = (method, url) => {
      if (url === VISUAL) return json({ title: "spend_by_month", code: "<p>spend</p>", loading: [] });
      if (url === LOOKUP) return json({ artifacts: [] });
      if (method === "POST" && url === "/api/artifacts") return json({ error: "Not kept: no such visual in this turn." }, 404);
      return null;
    };
    const refused = await drawn();
    refused.onclick();
    (await rows())[1].dispatch("click");
    await until(() => toasts().length, "said");
    assert.deepEqual([toasts(), opened], [["Not kept: no such visual in this turn."], []]);
  });

  test("a page that opens no artifact offers files alone, and asks nothing", async () => {
    chipActions.openArtifact = null;
    try {
      serve = (method, url) => (url === VISUAL ? json({ title: "spend_by_month", code: "<p>spend</p>", loading: [] }) : null);
      const save = await drawn();
      assert.equal(save.getAttribute("title"), "Save it as a file");
      save.onclick();
      assert.deepEqual((await rows()).map(labelOf), ["HTML file"]);
      assert.ok(!asked.some(([, url]) => url.startsWith("/api/artifacts")), "no lookup");
    } finally {
      chipActions.openArtifact = (name) => opened.push(name);
    }
  });

  // (fails before: yes — the bug hunt of 10-30, a Low: every visual's code the page read was kept for the page's life)
  test("the codes read are kept for the latest visuals: one drawn again soon is not read again, one read longest ago is", async () => {
    serve = (method, url) => (method === "GET" && /^\/api\/sessions\/c-kept\/turns\/1\/visuals\/v\d+$/.test(url) ? json({ title: "t", code: "<p>x</p>", loading: [] }) : url.startsWith("/api/artifacts?") ? json({ artifacts: [] }) : null);
    const draw = async (/** @type {string} */ id) => {
      const card = visualCard({ id, title: id }, { onAsk: () => {}, onTell: () => {} });
      doc.document.body.append(card.el);
      card.show({ chain: "c-kept", n: 1 });
      const save = /** @type {any} */ (card.el).querySelector(".visual-act");
      await until(() => !save.hasAttribute("disabled"), `${id}'s code read`);
    };
    const reads = (/** @type {string} */ id) => asked.filter(([m, u]) => m === "GET" && u === `/api/sessions/c-kept/turns/1/visuals/${id}`).length;
    await draw("v0");
    await draw("v0");
    assert.equal(reads("v0"), 1, "kept: read once");
    for (let i = 1; i <= 24; i++) await draw(`v${i}`);
    assert.equal(reads("v24"), 1);
    await draw("v24");
    assert.equal(reads("v24"), 1, "one of the latest stays kept");
    await draw("v0");
    assert.equal(reads("v0"), 2, "past the latest twenty-four: let go, and read again");
  });
});
