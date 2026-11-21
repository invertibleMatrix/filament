// A small real PDF for the read tests (HarnessV3-Tools TL-D26): one page per string, Helvetica text, a page with no
// text for "" (a scan has no text layer either). `pad` bytes of comment after the header make a big file whose text
// is small. Built by hand so pdftotext reads exactly what the test wrote.

/** @param {string} s */
const pdfString = (s) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;

/**
 * @param {string[]} pages @param {{ pad?: number }} [o]
 * @returns {Buffer}
 */
export function makePdf(pages, { pad = 0 } = {}) {
  /** @type {string[]} */
  const objs = [];
  const add = (/** @type {string} */ body) => objs.push(body);
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  for (const text of pages) {
    // Each line 40 points below the last: far enough apart that no reader joins them into one.
    const ops = text ? `BT /F1 12 Tf 40 TL 72 740 Td ${String(text).split("\n").map((l) => `${pdfString(l)} '`).join(" ")} ET` : "";
    const content = add(`<< /Length ${Buffer.byteLength(ops, "latin1")} >>\nstream\n${ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = `%PDF-1.4\n${pad ? `%${"x".repeat(pad)}\n` : ""}`;
  /** @type {number[]} */
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
