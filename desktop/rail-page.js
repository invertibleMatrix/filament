// @ts-check
// The app's page's script (rail.html): draws the state the app sends — the popover's rows built and escaped by the app
// (lib/rail.js railState) — and asks the app to show the machine picked, a machine's menu (its ⋯ or a right-click), the
// popover closed (Escape, a press outside it), and the Add sheet: the address or the link Settings › Remote access
// shows on the other machine, and its code; who answers there, and its certificate's fingerprint to compare where
// nothing vouches for it; then the pairing, which the app makes — or, for ssh://<alias>, the tunnel the app holds, and
// no code: ssh's own sign-in let this computer in. Above the fields, the machines of this computer's tailnet that run
// Filament, a press filling the address. A classic script: a module from a file:// page is refused. Its functions are
// tried on fakes in test/desktop-rail.test.js.
"use strict";

/** The popover's gap under the chip, and its least room from the window's edges. */
const POP_GAP = 6;
const POP_EDGE = 8;

/**
 * Where the popover stands under the chip pressed (`at`, in this page's pixels): its left edge at the chip's, kept
 * inside the window; its top under the chip, its height what is left under it.
 * @param {{ x: number, y: number, width: number, height: number }} at @param {{ width: number, height: number }} view
 * @param {number} [width]  the popover's
 */
function popPlace(at, view, width = 300) {
  const left = Math.max(POP_EDGE, Math.min(Math.round(at.x), Math.round(view.width - width - POP_EDGE)));
  const top = Math.round(at.y + at.height + POP_GAP);
  return { left, top, maxHeight: Math.max(120, Math.round(view.height - top - POP_EDGE)) };
}

/**
 * @param {any} doc @param {{ list?: string, at?: { x: number, y: number, width: number, height: number } | null, dark?: boolean, bg?: string, fg?: string, bar?: number, adding?: boolean }} s
 */
function drawRail(doc, s) {
  const root = doc.documentElement;
  if (s.bg) root.style.setProperty("--bg", s.bg);
  if (s.fg) root.style.setProperty("--fg", s.fg);
  root.style.setProperty("--bar", `${Math.max(0, Number(s.bar) || 0)}px`);
  root.classList.toggle("dark", s.dark !== false);
  const list = doc.getElementById("pop-list");
  // The focused row kept across a draw: the arrows and Enter go on where they were.
  const had = doc.activeElement?.getAttribute?.("data-machine");
  const was = doc.body.classList.contains("pop");
  if (list) list.innerHTML = String(s.list || "");
  const open = !!s.at && !s.adding;
  doc.body.classList.toggle("pop", open);
  doc.body.classList.toggle("adding", !!s.adding);
  const pop = doc.getElementById("pop");
  if (open && pop && s.at) {
    const view = doc.defaultView;
    const at = popPlace(s.at, { width: Number(view?.innerWidth) || 0, height: Number(view?.innerHeight) || 0 }, Number(pop.offsetWidth) || 300);
    pop.style.left = `${at.left}px`;
    pop.style.top = `${at.top}px`;
    pop.style.maxHeight = `${at.maxHeight}px`;
  }
  if (!open || !list) return;
  const picks = [...list.querySelectorAll("[data-machine]")];
  const back = had ? picks.find((b) => b.getAttribute("data-machine") === had) : null;
  // Opened: the keys on the machine showing, as a menu opens on its checked item.
  if (back) back.focus();
  else if (!was) (picks.find((b) => b.getAttribute("aria-checked") === "true") || picks[0])?.focus();
}

/** The popover's items in their order, for the arrows: each machine, then Add a machine. @param {any} doc */
const itemsOf = (doc) => [...(doc.getElementById("pop")?.querySelectorAll?.(".pick") ?? [])];

/** @param {any} doc @param {{ select: (id: string) => void, openAdd?: () => void, menu?: (id: string) => void, close?: () => void }} bridge */
function hearRail(doc, bridge) {
  doc.addEventListener("click", (/** @type {any} */ e) => {
    const t = e.target;
    if (t?.closest?.("[data-add]")) return bridge.openAdd?.();
    const more = t?.closest?.("[data-more]");
    if (more) return bridge.menu?.(String(more.getAttribute("data-more")));
    const b = t?.closest?.("[data-machine]");
    if (b) return bridge.select(String(b.getAttribute("data-machine")));
    if (t?.id === "scrim" && doc.body.classList.contains("pop")) bridge.close?.();
  });
  // A machine's own menu: its Colour and Icon, another machine's Remove too.
  doc.addEventListener("contextmenu", (/** @type {any} */ e) => {
    const b = e.target?.closest?.("[data-machine]");
    const id = b ? String(b.getAttribute("data-machine")) : "";
    e.preventDefault?.();
    if (id) bridge.menu?.(id);
  });
  // The popover's keys, as a menu's: the arrows, Home and End move between its items, Escape closes it.
  doc.addEventListener("keydown", (/** @type {any} */ e) => {
    if (!doc.body.classList.contains("pop") || doc.body.classList.contains("adding")) return;
    if (e.key === "Escape") {
      e.preventDefault?.();
      return bridge.close?.();
    }
    const items = itemsOf(doc);
    if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault?.();
    const at = items.indexOf(doc.activeElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (at + 1) % items.length : (at <= 0 ? items.length : at) - 1;
    items[next]?.focus();
  });
}

/**
 * @typedef {{ phase: "enter" | "compare" | "ready", busy: boolean, words: string, err: boolean, who: any, seen: string }} SheetView
 */

/**
 * The Add sheet's steps, apart from the page: what it shows after each of the person's acts, and what it asks the app.
 * `enter`: the address or link and the code; `compare`: the certificate's fingerprint the app read, for the person to
 * say whether the machine shows the same — nothing is sent there before; `ready`: who answers, and Pair — Add, through
 * an SSH tunnel (`who.ssh`), where no code is asked.
 * @param {{ add: (input: any) => Promise<any>, closeAdd: () => void }} bridge @param {(v: SheetView) => void} show
 */
function addFlow(bridge, show) {
  /** @type {SheetView["phase"]} */
  let phase = "enter";
  let busy = false;
  /** The fingerprint the person said is the same; the one the app read, to compare. */
  let print = "";
  let seen = "";
  /** @type {any} */
  let who = null;
  let link = "";
  let code = "";
  /** The sheet as opened: an answer to an ask from before Cancel or a reopening is not this sheet's (the review of p3-add). */
  let gen = 0;
  const view = (words = "", err = false) => show({ phase, busy, words, err, who, seen });
  return {
    reset() {
      gen++;
      phase = "enter";
      busy = false;
      print = seen = link = code = "";
      who = null;
      view();
    },
    /** The fields as they stand: another address starts over. @param {string} l @param {string} c */
    edit(l, c) {
      if (busy) return;
      if (String(l).trim() !== link.trim()) {
        const was = phase;
        phase = "enter";
        print = seen = "";
        who = null;
        if (was !== "enter") view();
      }
      link = String(l);
      code = String(c);
    },
    /**
     * The sheet's main button: Continue, It is the same, or Pair. `byEnter`: Enter pressed in a field, which never says
     * a fingerprint is the same — that is the button's alone, pressed after reading it (the review of p3-add).
     * @param {{ byEnter?: boolean }} [o]
     */
    async go({ byEnter = false } = {}) {
      if (busy) return;
      if (!link.trim()) return view("Paste the link, or type the address, that Settings › Remote access shows on the other machine.", true);
      if (phase === "compare" && byEnter) return view("Compare the fingerprint with the one that machine shows, then press It is the same — or Not the same.");
      if (phase === "compare") print = seen;
      const op = phase === "ready" ? "pair" : "check";
      if (op === "pair" && !who?.ssh && !who?.code && !code.trim()) return view(`Type the code Settings › Remote access shows on ${who?.name || "that machine"}.`, true);
      busy = true;
      const g = gen;
      view(op !== "pair" ? "Asking who answers there…" : who?.ssh ? `Adding ${who.name}…` : `Pairing with ${who?.name || "the machine"}…`);
      /** @type {any} */
      let got;
      try {
        // Pair goes to the machine Continue showed alone.
        got = await bridge.add({ op, link, code, fingerprint: print, ...(op === "pair" && who?.id ? { expect: who.id } : {}) });
      } catch (/** @type {any} */ e) {
        got = { ok: false, words: String(e?.message || e) };
      }
      if (g !== gen) return;
      busy = false;
      if (got?.ask === "fingerprint") {
        phase = "compare";
        seen = String(got.seen || "");
        return view(String(got.words || ""));
      }
      if (!got?.ok) {
        if (phase === "compare") phase = "enter";
        return view(String(got?.words || "Not added."), true);
      }
      // Paired: the app closes the sheet and shows the machine.
      if (op === "pair") return view(who?.ssh ? `Added ${got.name}.` : `Paired with ${got.name}.`);
      phase = "ready";
      who = got;
      view();
    },
    /** The fingerprint is not the one the machine shows: nothing was sent, and nothing will be. */
    notSame() {
      phase = "enter";
      print = seen = "";
      view("Nothing was sent. Another fingerprint means something else answered at that address: check it, and the network you are on.", true);
    },
    cancel: () => bridge.closeAdd(),
  };
}

/** The sheet drawn as the flow says it. @param {any} doc @param {SheetView} v */
function paintSheet(doc, v) {
  const $ = (/** @type {string} */ id) => doc.getElementById(id);
  const w = v.phase === "ready" ? v.who : null;
  $("add-go").textContent = w?.ssh ? "Add" : { enter: "Continue", compare: "It is the same", ready: "Pair" }[v.phase];
  $("add-go").disabled = v.busy;
  $("add-link").disabled = v.busy;
  // Through an SSH tunnel no code is asked: its field is held.
  $("add-code").disabled = v.busy || !!w?.ssh;
  $("add-back").hidden = v.phase !== "compare";
  $("add-print").hidden = v.phase !== "compare";
  $("add-print-fp").textContent = v.phase === "compare" ? v.seen : "";
  $("add-who").hidden = !w;
  $("add-who-name").textContent = !w ? "" : w.ssh ? `${w.name} answers through an SSH tunnel to ${w.ssh}` : `${w.name} answers at ${w.url}`;
  $("add-who-print").textContent = w?.ssh
    ? "No code: ssh signed in with your keys, and this computer holds the tunnel while the machine is in this window."
    : w?.fingerprint
      ? `Its certificate: ${w.fingerprint}`
      : w
        ? "Its certificate is one an authority vouches for."
        : "";
  $("add-who-print").classList.toggle("prose", !w?.fingerprint);
  $("add-who-kept").hidden = !w?.kept;
  $("add-who-kept").textContent = w?.ssh ? "It is in this window already: this SSH way goes first." : "It is in this window already: pairing again replaces this window's sign-in there.";
  $("add-said").textContent = v.words;
  $("add-said").classList.toggle("err", v.err);
  for (const b of $("add-peers-list")?.querySelectorAll?.("button") ?? []) b.disabled = v.busy;
}

/** How long the ask for the tailnet's machines goes before the sheet says it is looking. */
const SLOW_MS = 150;

/**
 * The machines of this computer's tailnet that answer as a Filament (lib/tailnet-peers.js), drawn in the sheet: each a
 * button with its host name as Tailscale says it, its address on the tailnet, its owner where that is not you, and
 * marked where it is in this window already. Made of elements, never markup. `got` null: still looking. None found and
 * nothing to say — no Tailscale here —: hidden.
 * @param {any} doc @param {{ found?: any[], words?: string } | null} got @param {(url: string) => void} pick
 */
function drawPeers(doc, got, pick) {
  const $ = (/** @type {string} */ id) => doc.getElementById(id);
  const box = $("add-peers");
  const list = $("add-peers-list");
  const said = $("add-peers-said");
  if (!box || !list || !said) return;
  const found = Array.isArray(got?.found) ? got.found : [];
  box.hidden = got !== null && !found.length && !got?.words;
  said.textContent = got === null ? "Looking for Filament on your tailnet…" : found.length ? "On your tailnet — press one to fill its address:" : String(got?.words || "");
  const busy = !!$("add-link")?.disabled;
  list.replaceChildren(
    ...found.map((f) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "peer";
      b.disabled = busy;
      const name = doc.createElement("b");
      name.textContent = String(f?.name || f?.host || "");
      const at = doc.createElement("span");
      at.textContent = [String(f?.host || ""), f?.owner ? `shared by ${f.owner}` : "", f?.kept ? "added" : ""].filter(Boolean).join(" · ");
      b.append(name, at);
      b.addEventListener("click", () => pick(String(f?.url || "")));
      return b;
    }),
  );
}

/**
 * The sheet's list of the tailnet's machines, asked of the app each time the sheet opens: hidden at first, "Looking…"
 * once the ask has taken `SLOW_MS` — a computer with no Tailscale answers at once, and shows nothing —, then what it
 * found. An answer for a sheet since closed or opened anew is not drawn.
 * @param {any} doc @param {{ tailnet?: () => Promise<any> }} bridge @param {(url: string) => void} pick
 * @param {{ later?: (fn: () => void, ms: number) => any, stop?: (t: any) => void }} [o]
 */
function peerLook(doc, bridge, pick, { later = setTimeout, stop = clearTimeout } = {}) {
  let gen = 0;
  return {
    open() {
      const g = ++gen;
      drawPeers(doc, { found: [], words: "" }, pick);
      const ask = bridge.tailnet;
      if (!ask) return;
      const slow = later(() => void (g === gen && drawPeers(doc, null, pick)), SLOW_MS);
      const done = (/** @type {any} */ got) => {
        stop(slow);
        if (g === gen) drawPeers(doc, got ?? { found: [], words: "" }, pick);
      };
      Promise.resolve()
        .then(() => ask())
        .then(done, () => done({ found: [], words: "" }));
    },
    close() {
      gen++;
    },
  };
}

/**
 * A machine of the tailnet pressed: its address in the field, as if typed — another address starts the sheet over —,
 * and the code's field next. Not while a step is under way.
 * @param {any} doc @param {{ edit: (link: string, code: string) => void }} flow
 */
function peerPick(doc, flow) {
  return (/** @type {string} */ url) => {
    const link = doc.getElementById("add-link");
    const code = doc.getElementById("add-code");
    if (!link || link.disabled || !url) return;
    link.value = url;
    flow.edit(url, String(code?.value ?? ""));
    code?.focus?.();
  };
}

/** The sheet's fields and buttons, heard. @param {any} doc @param {ReturnType<typeof addFlow>} flow */
function hearSheet(doc, flow) {
  const $ = (/** @type {string} */ id) => doc.getElementById(id);
  const fields = () => flow.edit($("add-link").value, $("add-code").value);
  $("add-link").addEventListener("input", fields);
  $("add-code").addEventListener("input", fields);
  // Enter in a field submits the form as the button would: said apart, as it accepts no fingerprint.
  let byEnter = false;
  $("add-form").addEventListener("keydown", (/** @type {any} */ e) => {
    byEnter = e.key === "Enter" && e.target?.tagName === "INPUT";
  });
  $("add-form").addEventListener("submit", (/** @type {any} */ e) => {
    e.preventDefault();
    fields();
    const enter = byEnter;
    byEnter = false;
    void flow.go({ byEnter: enter });
  });
  $("add-cancel").addEventListener("click", () => flow.cancel());
  $("add-back").addEventListener("click", () => flow.notSame());
  doc.addEventListener("keydown", (/** @type {any} */ e) => {
    if (e.key === "Escape" && doc.body.classList.contains("adding")) flow.cancel();
  });
}

if (typeof window !== "undefined" && /** @type {any} */ (window).filamentRail) {
  const bridge = /** @type {any} */ (window).filamentRail;
  const flow = addFlow(bridge, (v) => paintSheet(document, v));
  const peers = peerLook(document, bridge, peerPick(document, flow));
  hearRail(document, bridge);
  hearSheet(document, flow);
  let open = false;
  bridge.onState((/** @type {any} */ s) => {
    drawRail(document, s);
    if (!!s.adding === open) return;
    open = !!s.adding;
    if (!open) return peers.close();
    // Opened anew: an empty sheet, its first field ready, and the tailnet asked who runs Filament.
    /** @type {any} */ (document.getElementById("add-form"))?.reset?.();
    flow.reset();
    peers.open();
    /** @type {any} */ (document.getElementById("add-link"))?.focus();
  });
}
if (typeof module !== "undefined") module.exports = { popPlace, drawRail, hearRail, addFlow, paintSheet, hearSheet, drawPeers, peerLook, peerPick };
