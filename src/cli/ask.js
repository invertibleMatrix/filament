// @ts-check
// The command line's questions at a terminal (the owner's of 11-05: "helping noob users"): a line typed, a choice by
// its number, a yes or no — and a key typed as stars, never taken from the command's words (they stay in the
// shell's history and in an agent's transcript). Where no person is at a terminal, a question is a CliError that exits 4:
// the command says what it needs, and a key comes on stdin (`--key-stdin`).
import { createInterface } from "node:readline/promises";
import { CliError, EXIT } from "./client.js";

/**
 * The terminal a command asks at: its input and output, and whether a person is there.
 * @typedef {{ input: NodeJS.ReadableStream & { isTTY?: boolean, setRawMode?: (on: boolean) => void }, output: NodeJS.WritableStream & { isTTY?: boolean }, tty: boolean }} Term
 */

/** The process's own terminal. @returns {Term} */
export const processTerm = () => ({ input: process.stdin, output: process.stdout, tty: !!process.stdin.isTTY && !!process.stdout.isTTY });

/** What a question with no one to answer it says. @param {string} what */
const nobody = (what) => new CliError(`${what} — and no one is at a terminal to answer. Run it in a terminal, or give it on the command line (see --help).`, EXIT.needsPerson);

/**
 * A line typed, its default where it is left empty.
 * @param {Term} term @param {string} question @param {{ fallback?: string }} [o]
 */
export async function askLine(term, question, { fallback = "" } = {}) {
  if (!term.tty) throw nobody(question);
  // A terminal's line editing where the output is one; a scripted one (a test's) gets the prompt alone.
  const rl = createInterface({ input: term.input, output: term.output, terminal: !!term.output.isTTY });
  // Ctrl+C, or the terminal gone, ends the command (exit 130): never a question left waiting on nothing.
  const stop = new AbortController();
  rl.on("SIGINT", () => stop.abort());
  rl.on("close", () => stop.abort());
  try {
    const a = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ""} `, { signal: stop.signal })).trim();
    return a || fallback;
  } catch (/** @type {any} */ e) {
    if (e?.name === "AbortError") {
      term.output.write("\n");
      throw new CliError("Stopped.", EXIT.interrupted);
    }
    throw e;
  } finally {
    rl.close();
  }
}

/**
 * Yes or no: Enter takes `fallback`.
 * @param {Term} term @param {string} question @param {{ fallback?: boolean }} [o]
 */
export async function askYes(term, question, { fallback = true } = {}) {
  for (;;) {
    const a = (await askLine(term, `${question} ${fallback ? "[Y/n]" : "[y/N]"}`)).toLowerCase();
    if (!a) return fallback;
    if (["y", "yes"].includes(a)) return true;
    if (["n", "no"].includes(a)) return false;
  }
}

/**
 * One of `options`, by its number: its index, or -1 for `skip` (Enter alone, where `skip` names it).
 * @param {Term} term @param {string} question @param {readonly string[]} options @param {{ skip?: string }} [o]
 */
export async function askChoice(term, question, options, { skip = "" } = {}) {
  term.output.write(`${question}\n${options.map((o, i) => `  ${i + 1}. ${o}`).join("\n")}\n`);
  for (;;) {
    const a = await askLine(term, skip ? `Number (Enter: ${skip}):` : "Number:");
    if (!a && skip) return -1;
    const n = Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
  }
}

/**
 * A secret typed as stars, a star a key — Ctrl+C, or the terminal gone, ends the command (exit 130), as a
 * line's question does (`askLine`); Enter alone gives "".
 * @param {Term} term @param {string} question
 */
export function askSecret(term, question) {
  if (!term.tty || typeof term.input.setRawMode !== "function") return Promise.reject(nobody(question));
  const input = term.input;
  const setRaw = /** @type {(on: boolean) => void} */ (input.setRawMode).bind(input);
  return new Promise((resolve, reject) => {
    let typed = "";
    term.output.write(`${question} `);
    setRaw(true);
    input.resume();
    /** @param {Buffer | string} chunk */
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === "\u0003") return done(new CliError("Stopped.", EXIT.interrupted));
        if (ch === "\r" || ch === "\n") return done(null);
        if (ch === "\u007f" || ch === "\b") {
          if (typed) {
            typed = typed.slice(0, -1);
            term.output.write("\b \b");
          }
          continue;
        }
        if (ch >= " ") {
          typed += ch;
          term.output.write("*");
        }
      }
    };
    /** The terminal gone before an answer (the swarm's review of 11-10: the question waited on nothing). */
    const gone = () => done(new CliError("Stopped.", EXIT.interrupted));
    /** @param {Error | null} err */
    const done = (err) => {
      input.off("data", onData);
      input.off("end", gone);
      input.off("close", gone);
      setRaw(false);
      input.pause();
      term.output.write("\n");
      if (err) reject(err);
      else resolve(typed.trim());
    };
    input.on("data", onData);
    input.once("end", gone);
    input.once("close", gone);
  });
}

/** Everything on stdin, trimmed: a key piped in (`--key-stdin`). @param {NodeJS.ReadableStream} input */
export async function readAll(input) {
  let s = "";
  for await (const chunk of input) s += String(chunk);
  return s.trim();
}
