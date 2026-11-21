// @ts-check
// The rewound line (HarnessV3 Step 3, D11, §5; the Designer's rewind in place of 10-27): the turns a rewind took out
// of the conversation folded into one line where they stood, drawn as a compaction's line is — "↺ You rewound turns
// 5–7 and their files · Show them · Undo · Open as a fork", or "↺ Turns 5–7 were rewound in Codex" for another
// window's. Show them opens the turns greyed and read-only; Undo stands while the rewind can be taken back (until the
// next message); the fork button posts the line-fork route and opens what comes back. DOM-free parameters in, one
// element out (the `h` injectable). The words of the rewind's confirm live here too.
import { api } from "../lib/api.js";

/** Turns in a phrase: "turn 5", "turns 5–7". @param {any} from @param {any} to */
export const turnsWords = (from, to) => (Number(to) > Number(from) ? `turns ${from}–${to}` : `turn ${from}`);

/**
 * The rewind's line, by who rewound and what went back: the person's own here, either way; another window's.
 * @param {{ from?: any, to?: any, by?: string, what?: string, clientLabel?: string }} r @param {number} n  the turn the line stands at
 */
export function lineWords(r, n) {
  const span = turnsWords(r.from ?? n, r.to ?? r.from ?? n);
  if (r.by !== "harness") return `↺ ${span[0].toUpperCase()}${span.slice(1)} ${Number(r.to) > Number(r.from ?? n) ? "were" : "was"} rewound in ${r.clientLabel || "another window"}`;
  return r.what === "conversation" ? `↺ You rewound ${span} · the files kept their changes` : `↺ You rewound ${span} and their files`;
}

/** The line a rewind of the files alone leaves after the newest turn. @param {number} files @param {number} turn */
export const filesLineWords = (files, turn) => `↺ You put ${files === 1 ? "1 file back as it was" : `${files} files back as they were`} before turn ${turn}`;

/** What a rewind does to a file, in the confirm's words. @param {{ kind: string }} f @param {number} turn */
export const fileWords = (f, turn) =>
  f.kind === "deleted" ? `deleted — new since turn ${turn}` : f.kind === "restored" ? `brought back — deleted since turn ${turn}` : f.kind === "renamed" ? "renamed back" : "changed back";

/** The confirm's main button, by what goes back. @param {string} what */
export const rewindButton = (what) => (what === "conversation" ? "Rewind the conversation" : what === "files" ? "Put the files back" : "Rewind");

/**
 * @param {{ n: number, rewound: any, client?: string | null, userText?: string }} turn  the line's first turn
 * @param {any} chat
 * @param {{ open?: (row: any) => void, fork?: (chainId: string, line: string) => Promise<any>, h?: any,
 *   shown?: boolean, show?: (() => void) | null, undo?: (() => void) | null }} [io]
 */
export function rewoundRow(turn, chat, io = {}) {
  const mk = io.h || ((/** @type {string} */ tag, /** @type {any} */ attrs = {}, /** @type {any[]} */ ...kids) => ({ tag, attrs, kids }));
  const r = turn.rewound || {};
  const from = String(turn.userText || "").replace(/\s+/g, " ").trim();
  const act = (/** @type {string} */ label, /** @type {() => void} */ onclick, cls = "") => mk("button", { class: `boundary-toggle${cls}`, type: "button", onclick }, label);
  return mk("div", { class: "boundary-row is-rewound", ...(from ? { title: `From “${from.length > 60 ? `${from.slice(0, 59)}…` : from}”` } : {}) },
    mk("span", { class: "boundary-label" }, lineWords(r, turn.n)),
    io.show ? act(io.shown ? "Hide them" : "Show them", io.show) : null,
    io.undo ? act("Undo", io.undo, " is-undo") : null,
    act("Open as a fork", async () => {
      const row = await (io.fork || forkLineRoute)(String(chat.chainId), String(r.line || ""));
      if (row?.id) (io.open || (() => {}))(row);
    }));
}

/**
 * The line a rewind of the files alone leaves after the newest turn, while its Undo stands.
 * @param {{ turn: number, files: number }} r @param {{ h: any, undo: () => void, changes?: (() => void) | null }} io
 */
export function filesRewoundRow(r, io) {
  const mk = io.h;
  return mk("div", { class: "boundary-row is-rewound is-files-rewound" },
    mk("span", { class: "boundary-label" }, filesLineWords(r.files, r.turn)),
    io.changes ? mk("button", { class: "boundary-toggle", type: "button", onclick: io.changes }, "Show files") : null,
    mk("button", { class: "boundary-toggle is-undo", type: "button", onclick: io.undo }, "Undo"));
}

/** @param {string} chainId @param {string} line */
async function forkLineRoute(chainId, line) {
  try {
    return await api(`/sessions/${encodeURIComponent(chainId)}/lines/${encodeURIComponent(line)}/fork`, { method: "POST" });
  } catch {
    return null;
  }
}
