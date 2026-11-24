// The setup sheet of This computer's page (src/ui/harness/ssh-setup.js, the remote desk's s3b): its steps asked of the
// app in order, stopping at one that failed; a terminal opened where a step asks the person, the step asked again once
// it ends well; Retry, an offer and an also-line's terminal; the sheet closed meanwhile stopping its terminal — and the
// sheet drawn on the fake DOM: its field, its steps' words, the program its terminal runs, Open once paired.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SETUP_STEPS, openSshSetup, setupFlow } from "../src/ui/harness/ssh-setup.js";
import { STEPS } from "../desktop/lib/setup-over-ssh.js";
import { buttonsOf, fakeH, textOf } from "./helpers/fake-dom.js";

const flush = () => new Promise((r) => setTimeout(r, 0));
const TERM = { title: "ssh me@box", file: "ssh", args: ["-t", "--", "me@box", "exit"], line: "ssh -t me@box exit" };

/**
 * The flow over an app that answers each step from `answers` (a step's id → its answers in turn; none: done), and a
 * terminal service that records what it opened and stopped. @param {Record<string, any[]>} [answers]
 */
function rig(answers = {}) {
  /** @type {any[]} */
  const asked = [];
  /** @type {any[]} */
  const opened = [];
  /** @type {string[]} */
  const killed = [];
  /** @type {any[]} */
  const views = [];
  const flow = setupFlow(
    {
      run: async (input) => {
        asked.push({ ...input });
        const next = answers[input.step]?.shift();
        return next ?? { step: input.step, state: "done", words: `${input.step} done`, ...(input.step === "pair" ? { machine: { id: "m-box", name: "Box" } } : {}) };
      },
      open: async (t) => (opened.push(t), `t${opened.length}`),
      kill: (id) => void killed.push(id),
    },
    (v) => views.push(v),
  );
  return { flow, asked, opened, killed, views, last: () => views.at(-1) };
}

test("the sheet's steps are the app's, in its order", () => {
  assert.deepEqual(SETUP_STEPS, STEPS);
});

test("Set up: each step asked in turn for the host typed — ssh:// taken off —, each said as it went; every one gone, the machine paired is said", async () => {
  const t = rig();
  await t.flow.start("ssh://me@box");
  assert.deepEqual(t.asked, STEPS.map((s) => ({ alias: "me@box", step: s.id })));
  const v = t.last();
  assert.deepEqual(v.rows.map((/** @type {any} */ r) => [r.id, r.state, r.words]), STEPS.map((s) => [s.id, "done", `${s.id} done`]));
  assert.deepEqual([v.running, v.ended, v.machine], [false, "set", { id: "m-box", name: "Box" }]);
  assert.ok(t.views.some((x) => x.rows[2].state === "running" && x.rows[1].state === "done" && x.rows[3].state === "pending"), "one under way at a time, the rest not yet");
});

test("run again on a machine set up already: every step after the first had nothing to do, and the sheet says so", async () => {
  const skipped = Object.fromEntries(STEPS.slice(1).map((s) => [s.id, [{ step: s.id, state: "skipped", words: "as it was" }]]));
  const t = rig(skipped);
  await t.flow.start("me@box");
  assert.equal(t.last().ended, "nothing");
});

test("a step that failed stops the rest; Retry asks it again, then those after it", async () => {
  const t = rig({ service: [{ step: "service", state: "failed", words: "no systemd" }] });
  await t.flow.start("me@box");
  assert.deepEqual(t.asked.map((a) => a.step), ["reach", "install", "service"]);
  assert.deepEqual(t.last().rows.map((/** @type {any} */ r) => r.state), ["done", "done", "failed", "pending", "pending", "pending"]);
  assert.equal(t.last().ended, "");
  await t.flow.retry(2);
  assert.deepEqual(t.asked.map((a) => a.step), ["reach", "install", "service", "service", "setup", "route", "pair"]);
  assert.equal(t.last().ended, "set");
});

test("a step that asks the person: its terminal opened with ssh's program, the step asked again once it ends with 0 — or failed, said, where it ends otherwise", async () => {
  const ask = { step: "reach", state: "ask", words: "check the fingerprint", terminal: TERM };
  const t = rig({ reach: [ask, { ...ask }] });
  const p = t.flow.start("me@box");
  await flush();
  assert.deepEqual(t.opened, [TERM]);
  assert.deepEqual(t.last().term, { id: "t1", why: "check the fingerprint", line: "ssh -t me@box exit" });
  assert.equal(t.last().rows[0].state, "ask");
  t.flow.terminalEnded("t9", 0);
  await flush();
  assert.deepEqual(t.asked.length, 1, "another terminal's end goes on with nothing");
  t.flow.terminalEnded("t1", 0);
  await flush();
  assert.equal(t.asked.length, 2, "asked again");
  t.flow.terminalEnded("t2", 255);
  await p;
  const v = t.last();
  assert.equal(v.term, null);
  assert.deepEqual([v.rows[0].state, v.rows[0].words], ["failed", "The terminal ended with code 255 before it was answered: Retry asks again."]);
  assert.equal(t.asked.length, 2, "nothing after it asked");
});

test("no terminal opens here: said, with the line to run in one of the person's own", async () => {
  const t = rig({ reach: [{ step: "reach", state: "ask", words: "x", terminal: TERM }] });
  const flow = setupFlow(
    { run: async () => ({ step: "reach", state: "ask", words: "x", terminal: TERM }), open: async () => { throw new Error("no PTY"); }, kill: () => {} },
    (v) => t.views.push(v),
  );
  await flow.start("me@box");
  assert.deepEqual([t.last().rows[0].state, t.last().rows[0].words], ["failed", "No terminal opened here (no PTY): run ssh -t me@box exit in one of your own, then Retry."]);
});

test("an offer taken: its step asked again with it — the newest release —, the steps after it as they are", async () => {
  const t = rig({ install: [{ step: "install", state: "failed", words: "unreleased", offer: { label: "Install the newest release", latest: true } }] });
  await t.flow.start("me@box");
  assert.deepEqual(t.last().rows[1].offer, { label: "Install the newest release", latest: true });
  await t.flow.take(1);
  assert.deepEqual(t.asked.slice(2), [{ alias: "me@box", step: "install", latest: true }, ...STEPS.slice(2).map((s) => ({ alias: "me@box", step: s.id }))]);
});

test("an also-line run in a terminal: its step asked again alone once it ends well, to say what stands now", async () => {
  const line = { words: "Lingering is off", line: "sudo loginctl enable-linger $USER", terminal: { ...TERM, title: "Lingering" } };
  const t = rig({ service: [{ step: "service", state: "done", words: "runs", also: [line] }, { step: "service", state: "done", words: "runs at boot" }] });
  await t.flow.start("me@box");
  assert.deepEqual(t.last().rows[2].also, [line]);
  const n = t.asked.length;
  const p = t.flow.runLine(2, 0);
  await flush();
  assert.deepEqual(t.opened.at(-1), line.terminal);
  t.flow.terminalEnded("t1", 0);
  await p;
  assert.deepEqual(t.asked.slice(n), [{ alias: "me@box", step: "service" }], "that step alone");
  assert.deepEqual([t.last().rows[2].words, t.last().rows[2].also], ["runs at boot", []]);
  assert.equal(t.last().rows[3].state, "done", "the steps after it as they were");
});

test("a failed step's line run (this computer's key added there): once its terminal ends well, the setup goes on from that step", async () => {
  const line = { words: "Add this computer's key there", line: "ssh-copy-id me@box", terminal: { ...TERM, title: "Add the key" } };
  const t = rig({ reach: [{ step: "reach", state: "failed", words: "asks for a password", also: [line] }] });
  await t.flow.start("me@box");
  assert.equal(t.last().rows[0].state, "failed");
  const p = t.flow.runLine(0, 0);
  await flush();
  t.flow.terminalEnded("t1", 0);
  await p;
  assert.deepEqual(t.asked.map((a) => a.step), ["reach", ...STEPS.map((s) => s.id)]);
  assert.equal(t.last().ended, "set");
});

test("the sheet closed while its terminal runs:the terminal stopped, nothing painted after", async () => {
  const t = rig({ reach: [{ step: "reach", state: "ask", words: "x", terminal: TERM }] });
  const p = t.flow.start("me@box");
  await flush();
  const n = t.views.length;
  t.flow.close();
  await p;
  assert.deepEqual(t.killed, ["t1"]);
  assert.equal(t.views.length, n);
  assert.equal(t.asked.length, 1);
});

test("nothing typed: no step asked", async () => {
  const t = rig();
  await t.flow.start("  ");
  assert.equal(t.asked.length, 0);
});

test("the sheet: the host typed already in its field; Set up asks the app's bridge; a terminal runs ssh's program in Filament's terminal and shows it; Open shows the machine paired", async () => {
  /** @type {any[]} */
  const sheets = [];
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  const shown = [];
  /** @type {any[]} */
  const opened = [];
  let first = true;
  const app = {
    sshSetup: async (/** @type {any} */ input) => {
      if (input.step === "reach" && first) {
        first = false;
        return { step: "reach", state: "ask", words: "check the fingerprint", terminal: TERM };
      }
      return { step: input.step, state: "done", words: `${input.step} done`, ...(input.step === "pair" ? { machine: { id: "m-box", name: "Box" } } : {}) };
    },
    openOn: async (/** @type {string} */ id, /** @type {string} */ route) => (opened.push([id, route]), true),
  };
  const s = openSshSetup(
    { alias: "me@box" },
    {
      h: /** @type {any} */ (fakeH),
      app,
      api: async (path, init = {}) => (calls.push([init.method || "GET", path, init.body]), path === "/terminal" ? { ok: true, terminal: { id: "t7" } } : { ok: true }),
      sheet: /** @type {any} */ ((/** @type {any} */ x) => {
        const sh = { ...x, close() { sh.closed = true; x.onClose?.(); }, closed: false };
        sheets.push(sh);
        return sh;
      }),
      show: /** @type {any} */ ((/** @type {any} */ el, /** @type {string} */ id, /** @type {any} */ o) => (shown.push({ id, o }), { focus() {}, ended: () => false, dispose() {} })),
      copy: async () => {},
    },
  );
  const sh = sheets[0];
  assert.equal(sh.label, "Set up a machine over SSH");
  const field = sh.body.kids.find((/** @type {any} */ k) => String(k.attrs?.class).includes("ssh-ask")).kids[0];
  assert.equal(field.value, "me@box", "the host typed in the Add sheet, nothing started yet");
  assert.equal(calls.length, 0);
  buttonsOf(sh.body).find((b) => textOf(b) === "Set up").attrs.onclick();
  await flush();
  await flush();
  assert.deepEqual(calls[0], ["POST", "/terminal", { program: { file: "ssh", args: TERM.args }, title: "ssh me@box", cols: 100, rows: 24 }]);
  assert.equal(shown[0].id, "t7");
  assert.match(textOf(sh.body), /check the fingerprint/);
  shown[0].o.onExit(0);
  await flush();
  await flush();
  assert.match(textOf(sh.body), /Box is set up\|Box is in this window: pick it in the machines menu\./);
  assert.match(textOf(sh.body), /Reach it over SSH\| · done\|reach done/);
  const open = buttonsOf(sh.foot).find((b) => textOf(b) === "Open Box");
  assert.ok(open, "Open shows the machine paired");
  open.attrs.onclick();
  await flush();
  assert.deepEqual(opened, [["m-box", "#/"]]);
  assert.equal(sh.closed, true);
  s.close();
});
