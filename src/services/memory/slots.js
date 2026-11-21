// @ts-check
// Slots (HarnessV3-Memory MD-2, M2-5): a claim may name the one thing it gives a value of — its slot, "subject ·
// attribute" in its project, such as "project · package manager" holding "bun". A contradiction is then a key match,
// not a text match: a new value in a single-valued slot replaces the old one, and the same value again is evidence for
// the claim already there. Pure: the brain decides what each case does to the record.

const LEAD = /^(?:the|this|our|a|an|my|its)(?:\s+|$)/;
// What a coding session calls the project it is in. Its slots are the project's, whichever word the model used.
const PROJECT_WORDS = new Set(["project", "repo", "repository", "codebase", "code base", "app", "workspace", "monorepo"]);

/** A slot part or a value, for comparing: case, quotes, spacing, a leading article and trailing punctuation set aside. @param {any} s */
export const slotNorm = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEAD, "")
    .replace(/[\s.!?;:,]+$/, "")
    .trim();

/** Where a slot about the user starts: its subject as `slotOf` keys it ("user · editor"). */
export const USER_SLOT = "user · ";
/** Whether a slot is about the user (the memory plan's f5), whatever project holds it. @param {any} slot */
export const aboutUser = (slot) => String(slot || "").startsWith(USER_SLOT);

/**
 * A slot as the learner's model gave it, keyed, or null when it names no single thing with a value.
 * @param {any} raw  `{ subject, attribute, value, multi? }`
 * @returns {{ slot: string, value: string, multi: boolean } | null}
 */
export function slotOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  const subject = slotNorm(raw.subject);
  const attribute = slotNorm(raw.attribute);
  const value = String(raw.value ?? "").trim().slice(0, 120);
  if (!subject || !attribute || !slotNorm(value) || subject.length > 60 || attribute.length > 60) return null;
  return { slot: `${PROJECT_WORDS.has(subject) ? "project" : subject} · ${attribute}`, value, multi: raw.multi === true };
}

/**
 * Whether a standing claim in the slot holds this value — a slot's value, never empty (`slotOf` keeps none that is).
 * Its own value when it has one; a claim keyed without a value (a correction's replacement, which kept the slot of the
 * claim it replaced) holds the values its text names.
 * @param {{ slot_value?: string | null, text: string }} claim @param {string} value
 */
export function holdsValue(claim, value) {
  const v = slotNorm(value);
  if (claim.slot_value != null && claim.slot_value !== "") return slotNorm(claim.slot_value) === v;
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?:$|[^\\p{L}\\p{N}])`, "u").test(slotNorm(claim.text));
}
