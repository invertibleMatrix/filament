// @ts-check
// Run as a flow on the page (HarnessV4_OneAgent_Plan OA6, OA-D14): the button under a reply whose main agent offered it
// — its press hands the words of the message, which the page sends as the person's /flow — and the transcript's row that
// carries the offer to a reload. The offer's refusals and the turn's row are the throwaway's (flow-api.test.js); the
// tool's words are flow-tool.test.js's.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { flowOfferEl } from "../src/ui/harness/conversation/turn.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { stubDocument } from "./helpers/dom-stub.js";

describe("Run as a flow on the page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());

  // (fails before: yes — no turn drew the button)
  test("the button under an offered reply: its press hands the message's words; none where it was not offered, stopped, failed or wordless", () => {
    /** @type {string[]} */
    const pressed = [];
    const el = /** @type {any} */ (flowOfferEl({ flowOffer: true, status: "done", userText: "  plan it, then build it, then review it " }, (w) => pressed.push(w)));
    assert.equal(el.textContent, "Run as a flowYour agent offers to draw your message as a flow");
    el.querySelector(".zc-btn").dispatch("click");
    assert.deepEqual(pressed, ["plan it, then build it, then review it"]);
    const none = (/** @type {any} */ turn) => flowOfferEl(turn, () => {});
    assert.equal(none({ status: "done", userText: "plan it" }), null, "not offered");
    assert.equal(none({ flowOffer: true, status: "error", userText: "plan it" }), null, "failed");
    assert.equal(none({ flowOffer: true, status: "done", stopped: { by: "you" }, userText: "plan it" }), null, "stopped");
    assert.equal(none({ flowOffer: true, status: "done", userText: "(attachments)" }), null, "no words of the person's");
  });

  test("a reload draws it from the transcript's row", () => {
    const user = { role: "user", content: [{ type: "text", text: "plan it, then build it" }] };
    const final = { role: "assistant", content: [{ type: "text", text: "Three steps." }] };
    const [offered, plain] = transcriptTurns({ turns: [
      { n: 1, turnId: 1, requestIds: [], user, work: [], final, flowOffer: true },
      { n: 2, turnId: 2, requestIds: [], user, work: [], final },
    ] });
    assert.deepEqual([offered.flowOffer, plain.flowOffer], [true, undefined]);
    assert.ok(flowOfferEl(offered, () => {}));
    assert.equal(flowOfferEl(plain, () => {}), null);
  });
});
