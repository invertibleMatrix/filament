// @ts-check
// Filament's own notices — `[Filament: …]` — in words another machine sent: never one of Filament's. A report, a field,
// a Space's line from another machine is kept as data, its notice's bracket made a parenthesis, so it opens none.

/**
 * What a reader does not see, or may break a line at: controls (NEL among them), format characters (a soft hyphen, the
 * zero-width and bidi ones, tags), half a surrogate pair, and what a font draws nothing for (variation selectors, fillers).
 * A notice is read past each of them — never taken out of the words, where a script's joiner or an emoji's needs it
 * (the security re-read of 11-11: one of them after the bracket stepped over the filter).
 */
const UNSEEN = "\\p{C}\\p{Default_Ignorable_Code_Point}";
/** What may stand between a notice's bracket, its name and its colon: spaces and line breaks, and what no reader sees. */
const GAP = `[\\s${UNSEEN}]*`;
/**
 * A notice of this Filament's in another machine's words — `[Filament:`, in any case, spaced or not, a full-width
 * bracket or colon too, what no reader sees anywhere in it —, by its bracket.
 */
const NOTICE = new RegExp(`[[［](?=${GAP}${[..."filament"].join(`[${UNSEEN}]*`)}${GAP}[:：])`, "giu");

/** Another machine's words with no notice of Filament's in them. @param {unknown} s */
export const unnoticed = (s) => String(s ?? "").replace(NOTICE, "(");

/** What a notice is read past (`NOTICE`), each taken out as a piece is weighed. */
const GAPS = new RegExp(`[\\s${UNSEEN}]`, "gu");
/** How much of a piece's end, from a bracket on, is held for the next piece while it could still open a notice. */
const HOLD = 64;
/** Whether what follows a bracket could still become a notice's name and colon, with more words to come. @param {string} rest */
const mayOpen = (rest) => {
  const r = rest.replace(GAPS, "").toLowerCase();
  return r.length < 9 && ("filament:".startsWith(r) || "filament：".startsWith(r));
};

/**
 * Another machine's words as they come, piece by piece (a command's output there): each piece with no notice of
 * Filament's in it, one whose bracket ends a piece and whose name begins the next caught as well — the end of a piece
 * that could still open one is held for the next; `end` lets it go. One that could still open a notice and runs past
 * what is held (a bracket, then more spaces or unseen characters than HOLD) goes with its bracket a parenthesis: its
 * name may be the next piece, and nothing of it is kept to read against that.
 */
export function unnoticedStream() {
  let held = "";
  return {
    /** The piece as it may be read now. @param {string} text */
    take(text) {
      const s = held + String(text ?? "");
      const at = Math.max(s.lastIndexOf("["), s.lastIndexOf("［"));
      const open = at >= 0 && mayOpen(s.slice(at + 1));
      held = open && s.length - at <= HOLD ? s.slice(at) : "";
      if (open && !held) return `${unnoticed(s.slice(0, at))}(${s.slice(at + 1)}`;
      return unnoticed(held ? s.slice(0, at) : s);
    },
    /** What it still held, once nothing more comes. */
    end() {
      const s = held;
      held = "";
      return unnoticed(s);
    },
  };
}
