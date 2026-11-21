// Vendored from shared-utils 1.4.2.

/** One CSV line from its fields. */
export function csvRow(fields) {
  return fields.map((f) => String(f)).join(",");
}

/** The fields of one CSV line. */
export function parseRow(line) {
  return line.split(",");
}
