// @ts-check
// The PDFs Claude reads as they are, within the 100 pages a request takes (pdfs.js `pdfsAsSent`): the oldest past the
// room go as their text, by a line that moves in steps of a third of the room, as the media's does (core/media.js
// `stepLine`) — so a chat that gains a PDF a turn changes an older one's way once a step, not on every turn, and the
// provider's cache of the prompt before it holds. A PDF past the room alone goes as its text and takes none of it.
// Only pdfs.js and the PDF maker are read here.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PDFTOTEXT } from "../src/adapters/tools/pdf.js";
import * as pdfs from "../src/app/pipeline/dispatch/pdfs.js";
import { makePdf } from "./helpers/pdf.js";

/** A PDF of `n` pages, each a line of its own. @param {string} title @param {number} n */
const pdfOf = (title, n) => ({ type: "document", title, source: { type: "base64", media_type: "application/pdf", data: makePdf(Array.from({ length: n }, (_, i) => `${title} page ${i + 1}`)).toString("base64") } });

describe("Claude's PDFs within the 100 pages a request takes", { skip: !PDFTOTEXT && "needs pdftotext" }, () => {
  /** Which of the PDFs, one a message, go as their text. @param {any[]} list */
  const asText = async (list) => {
    const body = { messages: list.flatMap((d, i) => [{ role: "user", content: [d, { type: "text", text: `read ${i}` }] }, { role: "assistant", content: "read" }]) };
    const out = await pdfs.pdfsAsSent(body, { native: true, why: "" });
    return list.map((_, i) => i).filter((i) => out.body.messages[2 * i].content[0].type === "text");
  };

  // (fails before: yes — the newest went first while they fitted, so each PDF that came made the oldest still sent as it
  // was go as its text: an earlier message changed on every turn, and the provider's cache of all after it with it)
  test("ten-page PDFs that come one a turn: past 100 pages the same four oldest go as their text at 110, 120 and 130; past a step's worth, the line moves once", async () => {
    const all = Array.from({ length: 14 }, (_, i) => pdfOf(`p${i}.pdf`, 10));
    assert.deepEqual(await asText(all.slice(0, 10)), [], "100 pages: every one as it is");
    const first = await asText(all.slice(0, 11));
    assert.deepEqual(first, [0, 1, 2, 3], "110 pages: the line at 33, the four that begin before it");
    assert.deepEqual(await asText(all.slice(0, 12)), first, "120: the same");
    assert.deepEqual(await asText(all.slice(0, 13)), first, "130: the same");
    assert.deepEqual(await asText(all), [0, 1, 2, 3, 4, 5, 6], "140: the line at 66");
  });

  test("a PDF past the 100 pages alone goes as its text and takes none of the room: an older one still goes as it is", async () => {
    assert.deepEqual(await asText([pdfOf("short.pdf", 10), pdfOf("long.pdf", 150)]), [1]);
    const out = await pdfs.pdfsAsSent({ messages: [{ role: "user", content: [pdfOf("long.pdf", 150)] }] }, { native: true, why: "" });
    assert.deepEqual(out.notes, ['pdf: "long.pdf" sent as its text, 150 pages: past the 100 pages and 24 MB of PDFs a request carries, the newest first']);
  });
});
