// @ts-check
// The message box keeps the browser's undo (the bug hunt of 11-02, sa_99f2d575): a paste whose lines end with a new line
// — lines copied from an editor almost always do — and Shift+Enter went in through the browser's own inserts, and then
// the box drew itself again over what Chrome wrote: Ctrl+Z took back neither them nor the words typed before. Driven in
// a real Chrome (headless, over its DevTools protocol, on a throwaway profile): the box as the harness loads it, from
// src/ui, in a page of its own; real keys for typing, Shift+Enter, Backspace and Ctrl+Z, and a paste's own
// `beforeinput` with its plain text (the machine's clipboard is never touched). Without a Chrome or an Edge the suite
// says so and skips.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui");
const env = process.env;
/** A Chrome (or an Edge, a Chrome too) on this machine: `CHROME` where set, else where its installer puts it. */
const CHROME = [
  env.CHROME,
  ...(process.platform === "win32"
    ? [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean).flatMap((d) => [join(String(d), "Google", "Chrome", "Application", "chrome.exe"), join(String(d), "Microsoft", "Edge", "Application", "msedge.exe")])
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"]),
].find((p) => p && existsSync(p));

// The box in a page of its own, styled as the harness styles it (harness.css's `.composer-input`), one line 20px high.
// Each time the box draws itself again (`replaceChildren`, what its `draw` does) is counted.
const PAGE = `<!doctype html><meta charset="utf-8">
<style>.composer-input { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 20px; font: 16px/20px sans-serif; width: 400px; }</style>
<div id="host"></div>
<script type="module">
  import { createRichBox } from "/ui/harness/composer/rich-box.js";
  const box = createRichBox();
  document.getElementById("host").append(box);
  const draw = box.replaceChildren.bind(box);
  window.redraws = 0;
  box.replaceChildren = (...nodes) => { window.redraws++; draw(...nodes); };
  window.box = box;
</script>`;
const TYPES = /** @type {Record<string, string>} */ ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" });

describe("the message box, in Chrome, keeps the browser's undo", { skip: CHROME ? false : "no Chrome or Edge on this machine (CHROME names one)" }, () => {
  /** @type {import("node:http").Server} */
  let server;
  /** @type {import("node:child_process").ChildProcess} */
  let chrome;
  /** @type {WebSocket} */
  let ws;
  let profile = "";
  let sessionId = "";
  let seq = 0;
  /** @type {Map<number, { ok: (v: any) => void, no: (e: Error) => void }>} */
  const waiting = new Map();
  /** One DevTools command, its result. @param {string} method @param {object} [params] @returns {Promise<any>} */
  const send = (method, params = {}) =>
    new Promise((ok, no) => {
      const id = ++seq;
      waiting.set(id, { ok, no });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  /** An expression's value in the page. @param {string} expression */
  const page = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  /** A key pressed and let go, as the keyboard sends it. @param {string} key @param {{ shift?: boolean, ctrl?: boolean }} [mods] */
  const press = async (key, { shift = false, ctrl = false } = {}) => {
    const code = /** @type {Record<string, number>} */ ({ Enter: 13, Backspace: 8 })[key] ?? key.toUpperCase().charCodeAt(0);
    const k = { key, code: key.length > 1 ? key : `Key${key.toUpperCase()}`, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: (shift ? 8 : 0) | (ctrl ? 2 : 0) };
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...k });
    if (key === "Enter") await send("Input.dispatchKeyEvent", { type: "char", text: "\r", unmodifiedText: "\r", ...k });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
  };
  /** Words typed, as a keyboard's are. @param {string} text */
  const type = (text) => send("Input.insertText", { text });
  const undo = () => press("z", { ctrl: true });
  /** A paste of plain text, its `beforeinput` as the browser sends it. @param {string} words */
  const paste = (words) =>
    page(`(() => { const d = new DataTransfer(); d.setData("text/plain", ${JSON.stringify(words)}); box.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertFromPaste", dataTransfer: d, bubbles: true, cancelable: true })); })()`);
  /** The box as it stands: its text, the times it drew itself again since `fresh`, the lines it shows. @returns {Promise<{ value: string, redraws: number, lines: number }>} */
  const now = () => page(`({ value: box.value, redraws: window.redraws, lines: Math.round(box.getBoundingClientRect().height / 20) })`);
  /** The box empty and focused, its count of redraws at nought; words typed into it where given. @param {string} [typed] */
  const fresh = async (typed = "") => {
    await page(`box.value = ""; box.focus(); window.redraws = 0`);
    if (typed) await type(typed);
  };

  before(async () => {
    server = createServer((req, res) => {
      const path = new URL(String(req.url), "http://box").pathname;
      if (path === "/") return void res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
      const file = join(UI, path.slice("/ui/".length));
      if (path.startsWith("/ui/") && !path.includes("..") && existsSync(file)) return void res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(readFileSync(file));
      res.writeHead(404).end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
    const origin = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
    profile = mkdtempSync(join(tmpdir(), "rich-box-undo-"));
    chrome = spawn(/** @type {string} */ (CHROME), ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    let said = "";
    const at = await new Promise((ok, no) => {
      const timer = setTimeout(() => no(new Error(`Chrome gave no DevTools address: ${said}`)), 30000);
      chrome.stderr?.on("data", (d) => {
        said += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(said);
        if (m) (clearTimeout(timer), ok(m[1]));
      });
    });
    ws = new WebSocket(at);
    await new Promise((ok, no) => (ws.addEventListener("open", ok), ws.addEventListener("error", () => no(new Error("no DevTools connection")))));
    ws.addEventListener("message", (m) => {
      const d = JSON.parse(String(m.data));
      const w = waiting.get(d.id);
      if (!w) return;
      waiting.delete(d.id);
      d.error ? w.no(new Error(d.error.message)) : w.ok(d.result);
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    sessionId = (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    await send("Page.navigate", { url: `${origin}/` });
    for (let i = 0; i < 100 && !(await page("!!window.box").catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(await page("!!window.box"), true, "the box in the page");
  });
  after(async () => {
    ws?.close();
    chrome?.kill();
    server?.close();
    if (chrome && chrome.exitCode === null) await new Promise((r) => (chrome.once("exit", r), setTimeout(r, 5000)));
    // The throwaway profile, once Chrome lets go of it; one it still holds is left to the system's temp folder.
    if (profile) try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  });

  // (fails before: yes — Chrome's line break at the end is two new lines, "abc" "\n" "\n"; the box drew itself again
  // over them, and Ctrl+Z took back neither the new line nor the words typed before it)
  test("Shift+Enter at the end of the words: its new line and its line, the box as Chrome left it, and Ctrl+Z takes back the new line, then the words", async () => {
    await fresh("abc");
    await press("Enter", { shift: true });
    assert.deepEqual(await now(), { value: "abc\n", redraws: 0, lines: 2 });
    await type("d");
    assert.equal((await now()).value, "abc\nd", "the words go on in the new line");
    await undo();
    assert.equal((await now()).value, "abc\n");
    await undo();
    assert.equal((await now()).value, "abc", "the new line taken back");
    await undo();
    assert.equal((await now()).value, "", "the words typed before it too");
  });

  // (fails before: yes — the paste went in as "one\ntwo\n" with no line break after it: read back it lost its last new
  // line, and the box drew itself again from the words)
  test("a paste whose lines end with a new line, at the end: its words and its last line, the box as Chrome left it, and Ctrl+Z takes it back, then the words typed before", async () => {
    await fresh("ab");
    await paste("one\ntwo\n");
    assert.deepEqual(await now(), { value: "abone\ntwo\n", redraws: 0, lines: 3 });
    await undo();
    assert.equal((await now()).value, "ab", "the paste taken back");
    await undo();
    assert.equal((await now()).value, "", "the words typed before it too");
  });

  // (fails before: yes — the whole box selected, the paste took its words but not its last line break, which Chrome
  // dropped: one new line short, the box was drawn again)
  test("a paste ending with a new line over the whole box, and Shift+Enter after the box's last line break: no redraw, and Ctrl+Z takes each back", async () => {
    await fresh("ab");
    await press("Enter", { shift: true });
    await press("a", { ctrl: true });
    await paste("x\n");
    assert.deepEqual(await now(), { value: "x\n", redraws: 0, lines: 2 });
    await press("Enter", { shift: true });
    assert.deepEqual(await now(), { value: "x\n\n", redraws: 0, lines: 3 });
    await undo();
    assert.equal((await now()).value, "x\n");
    await undo();
    assert.equal((await now()).value, "ab\n", "the words the paste replaced");
  });

  // (fails before: yes — Backspace of a last line's one character, or of a new line at the end, leaves Chrome's own line
  // break at the end of the box, which the box drew again: Ctrl+Z took nothing back)
  test("Backspace at the end, where Chrome leaves a line break of its own: no redraw, and Ctrl+Z puts back what it took", async () => {
    await fresh("abc");
    await press("Enter", { shift: true });
    await type("d");
    await press("Backspace");
    assert.deepEqual(await now(), { value: "abc\n", redraws: 0, lines: 2 });
    await press("Backspace");
    assert.deepEqual(await now(), { value: "abc", redraws: 0, lines: 1 });
    await undo();
    assert.equal((await now()).value, "abc\nd", "both Backspaces, one step of Chrome's undo");
    await undo();
    assert.equal((await now()).value, "abc\n", "then the word typed");
  });

  // (fails before: yes — a Hunter's of 11-02: the whole box selected and deleted, Chrome leaves a line break of its own,
  // which the box drew away for its placeholder to show: Ctrl+Z put nothing back, and the empty draft was kept)
  test("the whole box deleted, where Chrome leaves a line break of its own: no redraw, marked empty, and Ctrl+Z puts the words back", async () => {
    await fresh("abc");
    await press("a", { ctrl: true });
    await press("Backspace");
    const gone = await page(`({ value: box.value, redraws: window.redraws, empty: box.classList.contains("is-empty"), kids: [...box.childNodes].map((n) => n.nodeName) })`);
    assert.deepEqual(gone, { value: "", redraws: 0, empty: true, kids: ["BR"] }, "as Chrome left it, its placeholder's mark on");
    await undo();
    assert.deepEqual(await page(`({ value: box.value, empty: box.classList.contains("is-empty") })`), { value: "abc", empty: false });
  });

  test("Shift+Enter in the middle of the words, and a paste of lines there: no redraw, and Ctrl+Z takes each back", async () => {
    await fresh("abcd");
    await page(`box.setSelectionRange(2, 2)`);
    await press("Enter", { shift: true });
    assert.deepEqual(await now(), { value: "ab\ncd", redraws: 0, lines: 2 });
    await paste("one\ntwo\n");
    assert.deepEqual(await now(), { value: "ab\none\ntwo\ncd", redraws: 0, lines: 4 });
    await undo();
    assert.equal((await now()).value, "ab\ncd");
    await undo();
    assert.equal((await now()).value, "abcd");
  });

  test("what the box must draw it still draws: a tag's words typed become the chat's link", async () => {
    await fresh("see ");
    await type("[agent](chat:abc123)");
    const after = await page(`({ value: box.value, redraws: window.redraws, link: box.querySelector("[data-tag]")?.getAttribute("data-chat") })`);
    assert.deepEqual(after, { value: "see [agent](chat:abc123)", redraws: 1, link: "abc123" });
  });
});
