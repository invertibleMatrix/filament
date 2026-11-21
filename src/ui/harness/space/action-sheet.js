// @ts-check
// A dashboard's button, pressed (HarnessV4_Space_Plan S3, SG-D11, the mock's screen 10): Filament's sheet, drawn by the
// harness outside the dashboard's frame — the page only asks, right after a click in it. Its sentence with the row's
// values, as text; its fields; the exact command it will run and where — or the connection's tool it calls, its args
// filled (S4a) —, following what is typed. Run sends the row's
// key and the answers alone: the server finds the row in what it read itself, fills and checks each part, and runs it.
// No clock cuts it: "Running… 12 s" with Stop. Done: the sheet closes, a toast with the program's last line; failed or
// refused: the words in the sheet, which stays open. Closed while it runs, its end is a toast, and a sheet opened again
// on the dashboard says what runs with Stop it (one runs at a time).
// No agent starts as the sheet opens, nor by itself after (the owner's word of 10-31): each is the person's to ask, on
// the model they see and may change — the one Filament would choose shown first, with why. A button that asks for a
// second look (S3b, SG-D12) offers one under its sentence: the Reviewer, which only reads, in the chat that made the
// version shown; Get a second look starts it, and its lines come as they come — Run never waits for them, and Run or
// closing the sheet stops it. Its card, a new page, closes the sheet too: while it reads, the person says so first.
// An agent may check it (S5d, SG-D25): "Then have an agent check it", off until the person ticks it — where the
// dashboard's author said what to look for (`verify`), the box says it —, then on the model shown. Run, it runs as
// ever; done, the sheet stays open on "Done: …" with the check's lines as they come — Stop check, Close —, and closing it
// lets the check go on: its verdict lands in What happened (and Needs you where it says no). A result goes to an agent
// too: Hand to an agent… — beside a failure in the sheet, in a done one's toast — fills the Start in the project's
// folder with the button, what ran and what it said. Nothing is sent there.
import { h } from "../../lib/dom.js";
import { button, confirmDialog, dialog, toast } from "../lib/ui.js";
import { pressWords } from "../lib/space-dashboards.js";
import { resultWords } from "../lib/space-view.js";
import { api } from "../lib/api.js";
import { openReviewerCard, secondLookView } from "../conversation/second-look.js";
import { createModelSelect } from "../composer/model.js";
import { modelRow } from "./model-row.js";

/**
 * @typedef {{ label: string, title: string, says: string, command: string[], tool?: import("../lib/space-dashboards.js").Tool | null,
 *   folder: string | null, ask: { name: string, label: string, required: boolean, choices: string[] | null }[],
 *   secondLook: boolean, verify?: string, checkOff?: string, skeptic?: { chain: string, model: string, why: string } | null,
 *   running: string | null }} ActionLook  the sheet as it opens (`POST …/dashboards/:name/actions/:action`): its sentence
 *   and command — or its tool call (S4a) — with the row's values, each field still its placeholder; what its author said
 *   a check looks for, and why no check could run ("" one can); who would look or check, should the person ask — the
 *   chat it runs in, and the model Filament would choose there, with why —; what runs on the dashboard now
 * @typedef {(method: string, path: string, body?: any) => Promise<{ ok: true, got: any } | { ok: false, error: string }>} Request
 *   a write to the Space whose refusal the caller says: its answer's Space drawn
 * @typedef {import("./model-row.js").Catalogue} Catalogue
 */

/** A button's words without the "…" that says a sheet opens: "Roll back to this…" → "Roll back to this". @param {string} label */
export const runLabel = (label) => label.replace(/\s*…$/, "") || label;

/**
 * The sheet, open.
 * @param {{ look: ActionLook, path: string, key: string, request: Request, second?: typeof secondLookView,
 *   handTo?: (words: string) => void, place?: string, catalogue?: Catalogue, modelSelect?: typeof createModelSelect,
 *   chatName?: (chain: string) => string, modelName?: (id: string) => string, openCard?: () => void }} o  `path`: the
 *   button's, under the Space (`/dashboards/:name/actions/:action`); `key`: the row it was pressed on; `second`: how a
 *   second look — and a check — is drawn (a test's stand-in); `handTo`: the Start in the project's folder with words in
 *   its box; `place`: the project's name, as those words say it; `catalogue` and `modelSelect`: the models a look or a
 *   check may run on, and the picker that lists them (a test's stand-in); `chatName`: a chat's title, as the left bar has
 *   it; `modelName`: a model's name as the picker says it; `openCard`: the Reviewer's card opened (a test's stand-in)
 */
export function actionSheet({ look, path, key, request, second = secondLookView, handTo, place = "", catalogue, modelSelect = createModelSelect, chatName, modelName, openCard = openReviewerCard }) {
  /** @type {Record<string, string>} */
  const answers = Object.fromEntries(look.ask.map((f) => [f.name, ""]));
  const run = runLabel(look.label);
  let running = false;
  let closed = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let ticking = null;
  /** Who would look or check, should the person ask: the chat it runs in, and the model Filament would choose there. */
  const who = look.skeptic || null;

  /**
   * The model a second look or a check starts on, the person's to choose before it does (the owner's word of 10-31):
   * the one Filament would choose there shown first, with why; their pick, said as theirs; Use the default back to it.
   * @param {string} lead  the row's words before the picker @param {string} named  the picker's, for a screen reader
   * @param {string} cls  its line's class @param {(ready: boolean) => void} changed  told whenever it may have changed
   */
  const modelChoice = (lead, named, cls, changed) => {
    const first = String(who?.model || "");
    const firstWords = first ? `Its model: ${who?.why || "the one Filament would choose"}` : "Choose the model it runs on";
    /** @type {ReturnType<typeof modelRow>} */
    const c = modelRow({
      lead, named, cls, catalogue, modelSelect, changed, alive: () => !closed,
      onPick: (name) => {
        c.show(name || first, name ? "Its model: your choice" : firstWords);
      },
      ...(first
        ? {
            onDefault: () => {
              c.show(first, firstWords);
            },
            defaultDesc: `Back to the one Filament would choose: ${who?.why || first}`,
          }
        : {}),
    });
    c.show(first, firstWords);
    return c;
  };

  const rest = h("p", { class: "sas-rest" });
  /** The Reviewer's second look, once it started: stopped on Run and on close. @type {{ chain: string, agent: string } | null} */
  let skeptic = null;
  const lookBox = h("div", { class: "sas-look" });
  lookBox.hidden = !look.secondLook;
  /** Whether its box holds the offer still, no look drawn in its place. */
  let offered = false;
  /** Whether the look drawn reads still: closing the sheet stops it before it ends. */
  let reading = false;
  const unlook = () => {
    const s = skeptic;
    skeptic = null;
    reading = false;
    if (s) void api(`/sessions/${encodeURIComponent(s.chain)}/second-looks/${encodeURIComponent(s.agent)}/stop`, { method: "POST" }).catch(() => {});
  };
  /**
   * The Reviewer's card, from the look drawn: a new page, which closes the sheet and stops the look — so while it reads,
   * the person says so first (found by the review of 10-31: the link stopped the look they asked for, unasked).
   */
  const cardFromLook = async () => {
    if (reading && !(await confirmDialog({ title: "Open the Reviewer's card?", description: "This sheet closes on the way, and its second look stops before it ends.", confirmLabel: "Open its card" }))) return;
    openCard();
  };
  /** Get a second look as the sheet stands: off while it starts, while the button runs, or while its model may not run. @type {(() => void) | null} */
  let paintLook = null;
  // A second look, offered (S3b): who would read, where, on the model shown — the person's to change —; nothing starts
  // until Get a second look, and a refusal is said in its line, where another model may be chosen.
  if (look.secondLook && !who) {
    offered = true;
    lookBox.append(h("div", { class: "sas-look-offer is-off" }, h("p", { class: "sas-look-who" }, `No second look: ${look.checkOff || "no chat can start one"}`)));
  } else if (look.secondLook && who) {
    const chat = String(chatName?.(who.chain) || "");
    const lookGo = /** @type {HTMLButtonElement} */ (button({ label: "Get a second look", variant: "outline", size: "xs", class: "sas-look-go", title: "Starts the Reviewer on the model shown: it only reads, and says in five lines what this would change" }));
    let starting = false;
    const choice = modelChoice("Runs on", "The model the second look runs on", "sas-look-why", () => paintLook?.());
    paintLook = () => void (lookGo.disabled = starting || running || !choice.ready());
    paintLook();
    lookGo.addEventListener("click", () => {
      if (starting || running || !choice.ready()) return;
      starting = true;
      paintLook?.();
      label(lookGo, "Starting…");
      void request("POST", `${path}/look`, { key, model: choice.model() }).then((r) => {
        starting = false;
        const ref = r.ok ? { chain: String(r.got?.chain || ""), agent: String(r.got?.agent || "") } : null;
        if (ref) skeptic = ref;
        if (ref && !closed && !running) {
          offered = false;
          reading = true;
          return void lookBox.replaceChildren(second(ref, { modelName, openCard: () => void cardFromLook(), onEnd: () => void (reading = false) }).el);
        }
        label(lookGo, "Get a second look");
        paintLook?.();
        // Run pressed, or the sheet closed, while it started: it has no part left.
        if (closed || running) return unlook();
        if (!r.ok) choice.say(`No second look: ${r.error}`);
      });
    });
    offered = true;
    lookBox.append(h("div", { class: "sas-look-offer" },
      h("p", { class: "sas-look-who" }, `The Reviewer, Filament's agent that only reads, says what this would change — in ${chat ? `“${chat}”, ` : ""}the chat that made ${look.title}. Nothing starts until you ask.`),
      h("div", { class: "sas-look-ask" }, choice.row, lookGo)));
  }
  // A button already running on the dashboard — this one's, its sheet closed while it ran, or another's: one runs at a
  // time, so Run waits until it ends, as the Space read again says or Stop it finds; Stop it is here, as no other place
  // has it once its own sheet is gone.
  const busyWords = h("span", { class: "sas-busy-t" });
  const stopBusy = button({ label: "Stop it", variant: "outline", size: "xs", class: "sas-busy-stop", title: "Stops what runs on this dashboard: its command's processes are ended" });
  const busy = h("p", { class: "sas-busy", role: "status" }, busyWords, " ", stopBusy);
  busy.hidden = !look.running;
  if (look.running) busyWords.textContent = `“${look.running}” is running on ${look.title}: Run once it ends, or stop it.`;
  /** Whether the run the sheet opened on goes on, as far as it knows: Run waits for its end. */
  let waiting = !!look.running;
  /** That run is over: said in its line — `words` —, Stop it gone, and this one may run. @param {string} words */
  const over = (words) => {
    waiting = false;
    busyWords.textContent = words;
    stopBusy.hidden = true;
    paint();
  };
  stopBusy.addEventListener("click", () => {
    /** @type {HTMLButtonElement} */ (stopBusy).disabled = true;
    void request("POST", `${path}/stop`, {}).then((r) => {
      if (closed) return;
      if (!r.ok && !/nothing of it is running/.test(r.error)) {
        /** @type {HTMLButtonElement} */ (stopBusy).disabled = false;
        return fail(r.error);
      }
      // Stopped, or it had ended already: either way this one may run.
      over(r.ok ? `You stopped “${look.running}”.` : `“${look.running}” has ended.`);
    });
  });
  const fields = look.ask.map((f) => {
    const id = `sas-${f.name}`;
    const input = /** @type {HTMLInputElement | HTMLSelectElement} */ (
      f.choices
        ? h("select", { class: "zc-input sas-input", id },
            h("option", { value: "" }, f.required ? "Choose…" : "None"),
            ...f.choices.map((c) => h("option", { value: c }, c)))
        : h("input", { class: "zc-input sas-input", id, type: "text", spellcheck: "false", autocomplete: "off" })
    );
    input.addEventListener("input", () => {
      answers[f.name] = input.value;
      paint();
    });
    input.addEventListener("change", () => {
      answers[f.name] = input.value;
      paint();
    });
    return h("label", { class: "sas-field", for: id },
      h("span", { class: "sas-label" }, f.label, ...(f.required ? [h("span", { class: "sas-needed" }, " · needed")] : [])),
      input);
  });
  const command = h("code", { class: "sas-cmd-text" });
  const where = h("div", { class: "sas-cmd" }, command, h("span", { class: "sas-where" }, ` · ${pressWords(look, answers).where}`));
  const said = h("p", { class: "sas-said", role: "alert" });
  said.hidden = true;
  // Then have an agent check it (S5d): off until the person ticks it — its author's `verify` says what it would look
  // for, and ticks nothing (the owner's word of 10-31) —, then on the model shown, theirs to change; off, saying why,
  // where none can run.
  const checkInput = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", class: "sas-check-box" }));
  checkInput.checked = false;
  checkInput.disabled = !!look.checkOff;
  const checkLine = h("label", { class: `sas-check${look.checkOff ? " is-off" : ""}` }, checkInput,
    h("span", { class: "sas-check-words" },
      h("span", { class: "sas-check-t" }, "Then have an agent check it"),
      h("span", { class: "sas-check-why" }, look.checkOff ? `No check: ${look.checkOff}` : look.verify ? `It looks for: ${look.verify}` : "Once it ran, an agent that only reads looks at whether it did what it says")));
  // Its model beside the box, not in its label: a press on the picker never ticks it. Made once the box is first ticked.
  const checkModel = h("div", { class: "sas-check-model" });
  checkModel.hidden = true;
  /** @type {ReturnType<typeof modelChoice> | null} */
  let checkChoice = null;
  /** Whether the check's model may run: Run waits for it while the box is ticked. */
  let checkReady = false;
  checkInput.addEventListener("change", () => {
    if (checkInput.checked && !checkChoice) {
      const chat = who ? String(chatName?.(who.chain) || "") : "";
      checkChoice = modelChoice("The Reviewer checks it on", "The model the check runs on", "sas-check-on", (ready) => {
        checkReady = ready;
        paint();
      });
      checkChoice.row.title = `Filament's agent that only reads, in ${chat ? `“${chat}”, ` : ""}the chat that made ${look.title}`;
      checkModel.append(checkChoice.row);
    }
    checkModel.hidden = !checkInput.checked;
    paint();
  });
  const doneEl = h("p", { class: "sas-done", role: "status" });
  doneEl.hidden = true;
  const checkBox = h("div", { class: "sas-checking" });
  const hand = button({ label: "Hand to an agent…", variant: "outline", class: "sas-hand", title: "The Start with this result in its box: nothing runs until you send" });
  hand.hidden = true;
  const stopCheck = button({ label: "Stop check", variant: "outline", class: "sas-check-stop", title: "Stops the agent's check: What happened says you stopped it" });
  stopCheck.hidden = true;
  const go = button({ label: run, class: "sas-go" });
  const back = button({ label: "Cancel", variant: "outline", class: "sas-back" });
  const foot = h("div", { class: "zc-dialog-foot sas-foot" },
    h("span", { class: "sas-note" }, `You press “${look.label}” on ${look.title} · it is said in What happened`),
    h("span", { class: "sb-sp" }), hand, stopCheck, back, go);
  const body = h("div", { class: "sas-body" }, rest, lookBox, busy, ...fields, where, checkLine, checkModel, doneEl, checkBox, said, foot);
  const d = dialog({ title: "", body, wide: true, onClose: () => { closed = true; unlook(); } });
  const card = /** @type {HTMLElement | null} */ (d.el.querySelector(".zc-dialog"));
  card?.classList.add("sas-sheet");
  const titleEl = /** @type {HTMLElement | null} */ (d.el.querySelector(".zc-dialog-title"));

  /** @param {HTMLButtonElement} b @param {string} words */
  const label = (b, words) => {
    const l = b.querySelector(".zc-btn-label");
    if (l) l.textContent = words;
  };
  /** The sentence, the command and Run as the fields stand — Run waits, too, for a check's model that may run. */
  function paint() {
    const w = pressWords(look, answers);
    if (titleEl) titleEl.textContent = w.title;
    card?.setAttribute("aria-label", w.title);
    rest.textContent = w.rest;
    rest.hidden = !w.rest;
    command.textContent = w.command;
    paintLook?.();
    if (running) return;
    const held = !!checkInput.checked && !checkReady;
    /** @type {HTMLButtonElement} */ (go).disabled = !w.ready || waiting || held;
    go.title = waiting
      ? `“${look.running}” is running on ${look.title}: Run once it ends, or stop it`
      : !w.ready ? "Fill what is needed first" : held ? "Choose a model the check can run on, or untick it" : `${look.tool ? "Calls" : "Runs"} ${w.command}`;
  }
  paint();

  /** @param {string} words */
  const fail = (words) => {
    said.textContent = words;
    said.hidden = false;
  };
  /** Back to a sheet that may run again. */
  const idle = () => {
    running = false;
    if (ticking) clearInterval(ticking);
    ticking = null;
    label(/** @type {HTMLButtonElement} */ (go), run);
    label(/** @type {HTMLButtonElement} */ (back), "Cancel");
    for (const el of body.querySelectorAll(".sas-input")) /** @type {HTMLInputElement} */ (el).disabled = false;
    paint();
  };

  back.addEventListener("click", () => {
    if (!running) return d.close();
    // Stop: its command's tree killed; the run's own answer says so.
    void request("POST", `${path}/stop`, {}).then((r) => {
      if (!r.ok) fail(r.error);
    });
  });
  /** The newest run's result, for Hand to an agent…: what ran, what it said, its failure. @type {{ ran: string, said: string, error: string } | null} */
  let result = null;
  /** The agent's check's Verdict, once it ended: its words, for Hand to an agent…. */
  let verdict = "";
  /** What Hand to an agent… puts in the Start's box. */
  const handWords = () => {
    const w = pressWords(look, answers);
    return resultWords({ place: place || "this project", dashboard: look.title, label: look.label, says: [w.title, w.rest].filter(Boolean).join(" "), ran: result?.ran || w.command, said: result?.said || "", error: result?.error || "", checked: verdict });
  };
  hand.addEventListener("click", () => {
    if (!handTo) return;
    handTo(handWords());
    d.close(true);
  });
  /** The agent checking it now, for Stop check. @type {{ chain: string, agent: string } | null} */
  let checking = null;
  stopCheck.addEventListener("click", () => {
    const c = checking;
    if (!c) return;
    /** @type {HTMLButtonElement} */ (stopCheck).disabled = true;
    void api(`/sessions/${encodeURIComponent(c.chain)}/second-looks/${encodeURIComponent(c.agent)}/stop`, { method: "POST" }).catch((/** @type {any} */ e) => {
      /** @type {HTMLButtonElement} */ (stopCheck).disabled = false;
      fail(String(e?.message || e));
    });
  });
  /**
   * Done, an agent checking it (S5d): the sheet stays — "Done: …", the check's lines as they come, Stop check and
   * Close —; closed, the check goes on, and its verdict lands in What happened.
   * @param {any} got  the run's answer
   */
  const checked = (got) => {
    go.hidden = true;
    checkLine.hidden = true;
    checkModel.hidden = true;
    // What ran is past a second look: its offer goes (found by the review of 10-31); a look drawn stays as it ended.
    if (offered) lookBox.hidden = true;
    label(/** @type {HTMLButtonElement} */ (back), "Close");
    for (const el of body.querySelectorAll(".sas-input")) /** @type {HTMLInputElement} */ (el).disabled = true;
    doneEl.textContent = `Done: ${got.said || "it said nothing"}`;
    doneEl.hidden = false;
    /** @type {{ chain: string, agent: string } | { error: string }} */
    const ref = got.check && "agent" in got.check ? { chain: String(got.check.chain), agent: String(got.check.agent) } : { error: String(got.check?.error || "it could not start") };
    checking = "agent" in ref ? ref : null;
    stopCheck.hidden = !checking;
    const onEnd = (/** @type {string[]} */ lines) => {
      stopCheck.hidden = true;
      // Its Verdict line as What happened reads it, "verdict:" too (found by the Hunter on S5d: lookLine takes a label
      // that starts upper case alone, so Hand lost the verdict What happened had).
      verdict = lines.map((l) => /^(?:\d+[.)]\s*)?verdict\s*:\s*(.+)$/i.exec(l.replace(/\*\*|__|`/g, "").trim())?.[1] || "").find(Boolean) || "";
    };
    checkBox.replaceChildren(second(ref, { title: "Agent check", none: "No check", onEnd, modelName }).el);
  };
  go.addEventListener("click", async () => {
    if (running || waiting || !pressWords(look, answers).ready || (checkInput.checked && !checkReady)) return;
    running = true;
    // Pressed: the second look has done its part.
    unlook();
    paintLook?.();
    said.hidden = true;
    const from = Date.now();
    /** @type {HTMLButtonElement} */ (go).disabled = true;
    label(/** @type {HTMLButtonElement} */ (back), "Stop");
    for (const el of body.querySelectorAll(".sas-input")) /** @type {HTMLInputElement} */ (el).disabled = true;
    checkInput.disabled = true;
    // The check, asked, on the model shown: the person's, held while it runs.
    const asked = checkInput.checked && checkChoice ? checkChoice.model() : "";
    if (asked) checkChoice?.hold("The check starts on this model once it ran");
    const tick = () => label(/** @type {HTMLButtonElement} */ (go), `Running… ${Math.round((Date.now() - from) / 1000)} s`);
    tick();
    ticking = setInterval(tick, 1000);
    const r = await request("POST", `${path}/run`, { key, ask: answers, ...(asked ? { check: { model: asked } } : {}) });
    idle();
    checkInput.disabled = !!look.checkOff;
    checkChoice?.hold(null);
    // It ran: what it ran and said, for Hand to an agent…; a refusal ran nothing.
    // How it ended, in What happened's words ("it failed: …", "you stopped it; …").
    if (r.ok) result = { ran: String(r.got?.ran || pressWords(look, answers).command), said: String(r.got?.output ?? r.got?.said ?? ""), error: r.got?.done ? "" : String(r.got?.outcome || (r.got?.error ? `it failed: ${r.got.error}` : "it failed")) };
    hand.hidden = !handTo || !result;
    if (r.ok && r.got?.done && r.got.check && !closed) return checked(r.got);
    if (r.ok && r.got?.done) {
      const check = !r.got.check ? "" : "error" in r.got.check ? ` · No check: ${r.got.check.error}` : " · an agent checks it: What happened will say";
      toast(`${run}: ${r.got.said || "done"}${check}`, "",
        handTo ? { action: { label: "Hand to an agent…", title: "The Start with this result in its box: nothing runs until you send", onClick: () => handTo(handWords()) } } : {});
      return d.close(true);
    }
    // Stopped: its end in What happened's words — a tool's server told to cancel, what it did before that done.
    const stopped = String(r.ok && r.got?.outcome ? r.got.outcome : "you stopped it");
    const words = r.ok ? (r.got?.error === "you stopped it" ? `${stopped[0].toUpperCase()}${stopped.slice(1)}.` : `It failed: ${r.got?.error || "it said nothing"}`) : r.error;
    // Closed while it ran: its toast has Hand to an agent… as a done one's has (found by the Hunter on S5d) — not for a
    // refusal, which ran nothing.
    if (closed)
      toast(`${run} on ${look.title}: ${words}`, "err",
        handTo && result ? { action: { label: "Hand to an agent…", title: "The Start with this result in its box: nothing runs until you send", onClick: () => handTo(handWords()) } } : {});
    else fail(words);
  });

  const first = /** @type {HTMLElement | null} */ (body.querySelector(".sas-input"));
  (first || go).focus();
  return {
    close: () => d.close(true),
    /** The Space read again says nothing runs on the dashboard: the run the sheet opened on has ended, and Run may. */
    ended() {
      if (waiting && !closed) over(`“${look.running}” has ended.`);
    },
  };
}
