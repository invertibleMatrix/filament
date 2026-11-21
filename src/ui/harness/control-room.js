// @ts-check
// The maximised control room: the sidebar and side pane hide, and the run fills the screen — a line saying where it
// stands, its spine (the rounds, the metrics, the replay scrubber once it ended), and the chat input at the bottom as
// the mailbox that steers it. Esc returns to the conversation.
import { h } from "../lib/dom.js";
import { api, followRun, RUN_GONE } from "./lib/api.js";
import { stationsFold, renderRun } from "./panes/run.js";
import { onceAFrame } from "./lib/once-a-frame.js";

/**
 * @param {HTMLElement} host
 * @param {string} runId
 * @param {{ onClose: () => void, onToast?: (msg: string, kind?: string) => void }} cb
 */
export function renderControlRoom(host, runId, cb) {
  const existing = host.querySelector(".control-room");
  if (existing) existing.remove();

  const status = h("div", { class: "cr-status" });
  const spineHost = h("div", { class: "cr-spine" });
  const note = h("p", { class: "pane-note hidden" });
  const mail = h("textarea", { class: "cr-mail", rows: "1", placeholder: "Send to this run, read at its next step — Enter sends, Shift+Enter breaks a line" });
  const send = h("button", { class: "primary sm", type: "button" }, "Send");
  const composer = h("form", { class: "cr-composer" }, mail, send);

  const room = h("div", { class: "control-room" },
    h("div", { class: "cr-bar" },
      h("span", { class: "cr-title" }, `Run ${runId}`),
      h("span", { class: "grow" }),
      h("button", { class: "ghost sm", type: "button", onclick: () => leave() }, "Back")),
    status,
    note,
    spineHost,
    composer);
  host.append(room);
  document.querySelector(".app-shell")?.classList.add("control-room-open");

  /** @type {any[]} */
  let events = [];
  /** @type {{ stop: () => void } | null} */
  let follower = null;
  /** Where the run stands, its events folded as they come: the whole run was grouped again at each one. */
  const stations = stationsFold();
  let folded = 0;
  /** The spine, made once the run is read and drawn again as its events come. @type {ReturnType<typeof renderRun> | null} */
  let spine = null;

  // The spine renders the room's own events, so it never opens a second stream on the same run.
  const paint = () => {
    while (folded < events.length) stations.add(events[folded++]);
    const view = stations.view();
    const live = view.rounds.find((/** @type {any} */ r) => r.state === "running") || view.rounds.at(-1);
    const thought = live?.thought ? ` · thought: “${live.thought.slice(-80)}”` : "";
    status.textContent = `${view.ended ? "ended" : "working"}${live ? ` · step ${live.n}` : ""}${thought}`;
    // One spine on the room's events, drawn again from them: a spine made anew at each event grouped the run again.
    if (spine) spine.refresh();
    else {
      spine = renderRun(spineHost, { runId, maximise: true, events, live: false });
      spine.load().catch(() => {});
    }
    composer.classList.toggle("hidden", view.ended);
  };
  // Once a frame, however many events land in it.
  const paintSoon = onceAFrame(paint);

  const steer = () => {
    const text = mail.value.trim();
    if (!text) return;
    mail.value = "";
    api(`/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text, from: "harness" } })
      .catch((e) => cb.onToast?.(String(/** @type {any} */ (e)?.message || e), "err"));
  };
  send.addEventListener("click", (e) => { e.preventDefault(); steer(); });
  composer.addEventListener("submit", (e) => { e.preventDefault(); steer(); });
  mail.addEventListener("keydown", (e) => {
    // An Enter that ends an IME composition picks the word; it sends nothing.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); steer(); }
  });

  const load = async () => {
    const page = await api(`/runs/${encodeURIComponent(runId)}/events?limit=50000`);
    events = page?.events || [];
    if (page?.run?.events && page.run.events > events.length) {
      note.textContent = `Showing the first ${events.length} events; the run is longer.`;
      note.classList.remove("hidden");
    }
    if (page?.gap) {
      note.textContent = `Events ${page.gap.requested + 1}–${page.gap.firstAvailable - 1} are no longer in the log.`;
      note.classList.remove("hidden");
    }
    paint();
    if (!stations.view().ended) {
      const last = events.at(-1);
      follower = followRun(runId, {
        since: last?.n || 0,
        onEvent: (e) => {
          if (!room.isConnected) { follower?.stop(); return; }
          events.push(e);
          paintSoon();
        },
        onGap: (g) => {
          note.textContent = `Events ${g.requested + 1}–${g.firstAvailable - 1} are no longer in the log.`;
          note.classList.remove("hidden");
        },
        onMissing: () => {
          note.textContent = RUN_GONE;
          note.classList.remove("hidden");
        },
      });
    }
  };
  load().catch((e) => spineHost.replaceChildren(h("div", { class: "pane-empty" }, `This run could not be opened: ${String(/** @type {any} */ (e)?.message || e)}`)));

  // Back and Esc are not the only ways out: a hash change removes the element without calling leave(), and the
  // shell's panels would stay hidden. Tearing down on detach covers every path.
  const watcher = new MutationObserver(() => {
    if (room.isConnected) return;
    watcher.disconnect();
    window.removeEventListener("keydown", onKey);
    follower?.stop();
    document.querySelector(".app-shell")?.classList.remove("control-room-open");
  });
  if (room.parentElement) watcher.observe(room.parentElement, { childList: true });

  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (!room.isConnected) { window.removeEventListener("keydown", onKey); return; }
    if (e.key !== "Escape") return;
    if (document.querySelector("dialog[open], .modal, .zc-menu, .zc-dialog-overlay")) return;
    leave();
  };
  window.addEventListener("keydown", onKey);

  const leave = () => {
    window.removeEventListener("keydown", onKey);
    follower?.stop();
    document.querySelector(".app-shell")?.classList.remove("control-room-open");
    room.remove();
    cb.onClose();
  };
  return { el: room };
}
