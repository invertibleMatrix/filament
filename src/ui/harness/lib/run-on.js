// @ts-check
// Run on (the remote desk's s2c): where a new chat runs — this computer, another machine kept for this Filament's
// agents, or Auto, which picks one of them and says why. The machines and what each has to work with are this
// computer's word (GET /api/remote-work/places, app/remote-work.js `places`); Auto weighs them here, and the chip says
// its pick and its reason. A chat started there runs in a clean clone of the project at this folder's commit where one
// is there and nothing here is uncommitted; else in a copy of this folder sent with the person's work (POST
// /api/remote-work, asked first), which the app's own device there starts the chat in (the desk bridge's `create`,
// desktop/lib/desk.js) and names to the record (…/chat) so what it changes can come back. Nothing here draws.

/** This computer, as the chip holds it. */
export const HERE = "";
/** Auto, as the chip holds it. */
export const AUTO = "auto";

/**
 * A machine as the page reads `places` (remote-agents.js `RunOnPlace`).
 * @typedef {{ id: string, name: string, answers: boolean, words: string | null, personCopy: boolean, maker: string | null, cpus: number | null, load1: number | null, busy: number | null,
 *   memFree: number | null, memTotal: number | null, models: string[] | null, clones: { path: string, head: string | null, branch: string | null, dirty: boolean | null }[] | null }} Place
 * The folder here in git, as `places` says it: `sub`, this folder within its repository (forward slashes, "" its top).
 * @typedef {{ remote: string | null, head: string | null, branch: string | null, dirty: boolean | null, sub: string } | null} Here
 * What `places` answers. @typedef {{ here: Here, machines: Place[], last: string | null }} Places
 */

/** A number another machine said, else null. @param {unknown} v */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Words as kept: one line, `n` characters at most. @param {unknown} v @param {number} [n] */
const line = (v, n = 300) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n) : "");

/** A folder within a repository, as `places` says it: its names, none a step up; else its top (""). @param {unknown} v */
const subOf = (v) => {
  const parts = typeof v === "string" && v.length <= 400 ? v.split("/").filter(Boolean) : [];
  return parts.some((x) => x === ".." || x === "." || /[\\\u0000-\u001f]/.test(x) || /^[A-Za-z]:/.test(x)) ? "" : parts.join("/");
};

/**
 * `places` as this page reads it: each field checked or dropped — its words are other machines' in part. Null for what
 * is no answer. @param {unknown} raw @returns {Places | null}
 */
export function readPlaces(raw) {
  const r = /** @type {any} */ (raw);
  if (!r || typeof r !== "object" || !Array.isArray(r.machines)) return null;
  const commitOf = (/** @type {unknown} */ v) => (typeof v === "string" && /^[0-9a-f]{40,64}$/.test(v) ? v : null);
  const h = r.here && typeof r.here === "object" ? r.here : null;
  /** @type {Place[]} */
  const machines = [];
  for (const m of r.machines.slice(0, 32)) {
    const id = typeof m?.id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(m.id) ? m.id : "";
    if (!id || machines.some((x) => x.id === id)) continue;
    machines.push({
      id,
      name: line(m.name, 80) || "Another machine",
      answers: m.answers === true,
      words: line(m.words) || null,
      personCopy: m.personCopy === true,
      maker: typeof m.maker === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(m.maker) ? m.maker : null,
      cpus: num(m.cpus),
      load1: num(m.load1),
      busy: num(m.busy),
      memFree: num(m.memFree),
      memTotal: num(m.memTotal),
      models: Array.isArray(m.models) ? m.models.filter((/** @type {unknown} */ x) => typeof x === "string").slice(0, 300) : null,
      clones: Array.isArray(m.clones)
        ? m.clones.slice(0, 20).map((/** @type {any} */ c) => ({ path: line(c?.path, 400), head: commitOf(c?.head), branch: line(c?.branch, 200) || null, dirty: typeof c?.dirty === "boolean" ? c.dirty : null })).filter((/** @type {{ path: string }} */ c) => !!c.path)
        : null,
    });
  }
  return {
    here: h ? { remote: line(h.remote, 400) || null, head: commitOf(h.head), branch: line(h.branch, 200) || null, dirty: typeof h.dirty === "boolean" ? h.dirty : null, sub: subOf(h.sub) } : null,
    machines,
    last: typeof r.last === "string" && machines.some((x) => x.id === r.last) ? r.last : null,
  };
}

/**
 * A clone there the chat may start in as it is: clean, at this folder's commit, with nothing uncommitted here — what
 * the person would see there is what they have here. Else null. @param {Place} p @param {Here} here
 */
export function cleanClone(p, here) {
  if (!here?.head || here.dirty !== false) return null;
  return (p.clones || []).find((c) => c.head === here.head && c.dirty === false) ?? null;
}

/** Whether the machine starts a chat of the person's at all: it answers, and takes one in a copy or has a clean clone. @param {Place} p @param {Here} here */
export const usable = (p, here) => p.answers && (p.personCopy || !!cleanClone(p, here));

/** How idle it is now, 0 to 1, from its load or its busy percent; null where it did not say. @param {Place} p */
export function idleOf(p) {
  if (p.cpus && p.load1 != null) return Math.max(0, Math.min(1, 1 - p.load1 / p.cpus));
  if (p.busy != null) return Math.max(0, Math.min(1, 1 - p.busy / 100));
  return null;
}

/** Its memory free, 0 to 1; null where it did not say. @param {Place} p */
export const memoryOf = (p) => (p.memFree != null && p.memTotal ? Math.max(0, Math.min(1, p.memFree / p.memTotal)) : null);

/**
 * Whether the chat's model answers there: false where it named its models and not this one; null where it named none —
 * it did not say, or serves its models by a pattern alone, which no list names. @param {Place} p @param {string} model
 */
export const modelThere = (p, model) => (!model || !p.models?.length ? null : p.models.includes(model));

/**
 * The model the chat starts on there: the chat's where it answers there, or where that machine named none; else the
 * first that answers there. @param {Place} p @param {string} model
 */
export const modelFor = (p, model) => (modelThere(p, model) === false ? p.models?.[0] || model : model);

/**
 * Where the chat starts in a clean clone: this folder within its repository, in the clone, in that machine's own
 * separators. @param {{ path: string }} clone @param {Here} here
 */
export const cloneFolder = (clone, here) => {
  if (!here?.sub) return clone.path;
  const sep = clone.path.includes("\\") ? "\\" : "/";
  return `${clone.path.replace(/[\\/]+$/, "")}${sep}${here.sub.split("/").join(sep)}`;
};

/**
 * Auto's points for a machine (the remote desk's plan): +3 a clean clone at this folder's commit, else +2 any clone of
 * it there; +3 × how idle it is (unsaid: half); +1 × its memory free (unsaid: half); −0.5 for each chat at work there,
 * −2 at most; −2 where the chat's model does not answer there (another of its own does).
 * @param {Place} p @param {{ here: Here, running?: number, model?: string }} o
 */
export function pointsOf(p, { here, running = 0, model = "" }) {
  let n = cleanClone(p, here) ? 3 : p.clones?.length ? 2 : 0;
  n += 3 * (idleOf(p) ?? 0.5);
  n += memoryOf(p) ?? 0.5;
  n -= Math.min(2, 0.5 * Math.max(0, running));
  if (modelThere(p, model) === false) n -= 2;
  return Math.round(n * 100) / 100;
}

/**
 * Why Auto picked it, in words for the chip's hover. @param {Place} p @param {{ here: Here, last: string | null, running?: number, model?: string }} o
 */
export function whyWords(p, { here, last, running = 0, model = "" }) {
  const idle = idleOf(p);
  const memory = memoryOf(p);
  return [
    cleanClone(p, here) ? "a clean clone at your commit" : p.clones?.length ? "it has this project; a copy of this folder goes, your work with it" : "a copy of this folder, your work with it",
    idle != null ? `${Math.round(idle * 100)}% idle` : "",
    memory != null ? `${Math.round(memory * 100)}% of its memory free` : "",
    running > 0 ? `${running} chat${running === 1 ? "" : "s"} at work there` : "",
    modelThere(p, model) === false ? `your model does not answer there: it runs on ${p.models?.[0]}` : "",
    last === p.id ? "where this project ran last" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Auto's pick: of the machines that start a chat of the person's (`usable`), the most points; a tie goes to where this
 * project ran last, then the list's order. None where none is usable, with why.
 * @param {Places | null} places @param {{ running?: ReadonlyMap<string, number>, model?: string }} [o]
 * @returns {{ pick: Place | null, why: string }}
 */
export function autoPick(places, { running = new Map(), model = "" } = {}) {
  if (!places?.machines.length) return { pick: null, why: "No machine is kept for this Filament's agents: switch Run on on for one in Settings › Remote access" };
  const here = places.here;
  const ok = places.machines.filter((p) => usable(p, here));
  if (!ok.length) {
    const away = places.machines.filter((p) => !p.answers);
    return { pick: null, why: away.length === places.machines.length ? "No machine answers now" : "No machine that answers takes a chat of yours: update Filament there, or switch Run on on for it" };
  }
  const scored = ok.map((p, i) => ({ p, i, n: pointsOf(p, { here, running: running.get(p.id) || 0, model }) }));
  scored.sort((a, b) => b.n - a.n || (b.p.id === places.last ? 1 : 0) - (a.p.id === places.last ? 1 : 0) || a.i - b.i);
  const pick = scored[0].p;
  return { pick, why: whyWords(pick, { here, last: places.last, running: running.get(pick.id) || 0, model }) };
}

/**
 * What the chip says for a choice: This computer, the machine's name, or Auto's pick. @param {string} choice
 * @param {Places | null} places @param {{ running?: ReadonlyMap<string, number>, model?: string, name?: string }} [o]  `name`: the machine's name where `places` has not answered
 * @returns {{ label: string, title: string }}
 */
export function chipWords(choice, places, { running, model = "", name = "" } = {}) {
  if (choice === HERE) return { label: "This computer", title: "The chat runs on this computer" };
  if (choice === AUTO) {
    if (!places) return { label: "Auto", title: "Auto picks the idlest of your machines that has this project: reading them…" };
    const a = autoPick(places, { running, model });
    return a.pick ? { label: `Auto → ${a.pick.name}`, title: `Auto picked ${a.pick.name}: ${a.why}` } : { label: "Auto: no machine", title: a.why };
  }
  const p = places?.machines.find((m) => m.id === choice) ?? null;
  const label = p?.name || name || "Another machine";
  if (!places) return { label, title: `The chat runs on ${label}` };
  if (!p) return { label, title: `${label} is no machine kept for this Filament's agents now: pick another` };
  if (!p.answers) return { label, title: `${p.name} does not answer now${p.words ? `: ${p.words}` : ""}` };
  if (!usable(p, places.here)) return { label, title: `${p.name} takes no chat of yours yet: update Filament there` };
  return { label, title: `The chat runs on ${p.name}: ${whyWords(p, { here: places.here, last: places.last, running: running?.get(p.id) || 0, model })}` };
}

/**
 * The machine a send goes to for a choice, or why none: a machine named that does not answer or takes no chat of the
 * person's is said so, never swapped for another (the choice is never changed at send time).
 * @param {string} choice @param {Places | null} places @param {{ running?: ReadonlyMap<string, number>, model?: string }} [o]
 * @returns {{ place: Place } | { words: string }}
 */
export function placeFor(choice, places, o = {}) {
  if (!places) return { words: "Your machines could not be read: try again, or run it on this computer" };
  if (choice === AUTO) {
    const a = autoPick(places, o);
    return a.pick ? { place: a.pick } : { words: `Auto found no machine: ${a.why}` };
  }
  const p = places.machines.find((m) => m.id === choice);
  if (!p) return { words: "That machine is kept for this Filament's agents no more: pick another in Run on" };
  if (!p.answers) return { words: `${p.name} does not answer now${p.words ? ` (${p.words})` : ""}: pick another in Run on, or This computer` };
  if (!usable(p, places.here)) return { words: `${p.name} takes no chat of yours yet: update Filament there, or pick another in Run on` };
  return { place: p };
}

/**
 * Why this window may not start a chat of the person's in a copy placed there, or "": a copy placed for the person is
 * the chat's of the full device that made this Filament's agents' device there (services/copies.js `ownedAt`), so a
 * window that reaches it by the person's tailnet login, through a tunnel, or as another device is told before anything
 * is sent. @param {Place} place @param {any} me  the desk bridge's `me` answer
 */
export function copyRefusal(place, me) {
  if (!me?.ok) return `${place.name} did not say who this window is there: ${line(me?.words, 200) || "it did not answer"}`;
  const who = me.json?.who;
  if (who !== "device") return `This app reaches ${place.name} ${who === "tailnet" ? "by your tailnet login" : "through a tunnel"}, not as a paired Full device, and your chat in a copy there starts from one: pair ${place.name} as Full with Add a machine`;
  if (place.maker && me.json?.device !== place.maker)
    return `This window is not the device that made this Filament's agents' device on ${place.name}, and your chat in a copy there starts from that one: in Settings › Remote access, forget ${place.name}'s agents' device and switch Run on on for it again`;
  return "";
}

/**
 * A first message sent to run on another machine: in its clean clone, else in a copy of this folder sent with your work
 * — this window checked first as the device the copy's chat starts from (`copyRefusal`), then asked (`allow`: the ask,
 * as the server said it; true sends it) —; the chat started there by the app's own device (the desk bridge's `create`,
 * on the chat's model, or one that answers there, and in its mode), named to the record, the message sent, and the
 * chat opened in place. `started`: a chat started there before whose message did not go — the message alone goes now.
 * → the chat there; else why not, in words, and the chat where one stands there (`started`), whose message did not go.
 * @param {{ place: Place, here: Here, folder: string, text: string, model?: string, mode?: string, started?: { chat: string, work: any | null } | null }} o
 * @param {{ api: (path: string, init?: any) => Promise<any>, call: (p: any) => Promise<any>, allow: (ask: any) => Promise<boolean>, open: (machine: { id: string, name: string }, chat: string) => void }} io
 * @returns {Promise<{ ok: true, chat: string, work: any | null, unsure?: string } | { ok: false, words: string, said?: boolean, started?: { chat: string, work: any | null } }>}
 */
export async function runOnSend({ place, here, folder, text, model = "", mode = "", started = null }, io) {
  if (started) return turnThere(place, started, text, io);
  const clone = cleanClone(place, here);
  /** @type {any} */
  let work = null;
  let cwd = clone ? cloneFolder(clone, here) : "";
  if (!clone) {
    const no = copyRefusal(place, await io.call({ op: "me", machine: place.id }));
    if (no) return { ok: false, words: no };
    /** @type {{ ask: string } | null} */
    let allow = null;
    for (let tries = 0; !work && tries < 3; tries++) {
      try {
        work = (await io.api("/remote-work", { method: "POST", body: { machine: place.id, folder, ...(allow ? { allow } : {}) } }))?.work ?? null;
        if (!work) return { ok: false, words: `${place.name} named no copy for your chat` };
      } catch (/** @type {any} */ e) {
        const ask = e?.status === 409 ? e?.body?.ask : null;
        if (!ask?.id) return { ok: false, words: line(e?.message || e, 500) || `the copy did not reach ${place.name}` };
        if (!(await io.allow(ask))) return { ok: false, words: `Nothing went to ${place.name}: your message is back in the box`, said: true };
        allow = { ask: ask.id };
      }
    }
    if (!work) return { ok: false, words: `${place.name} kept asking: nothing was sent` };
    cwd = String(work.cwd || "");
  }
  const on = modelFor(place, model);
  const made = await io.call({ op: "create", machine: place.id, cwd, ...(on ? { model: on } : {}), ...(mode ? { mode } : {}) });
  const chat = made?.ok ? String(made.json?.chat || "") : "";
  if (!chat) return { ok: false, words: `${made?.words || `${place.name} started no chat`}${work ? `. The copy of your work waits there a quarter of an hour for a chat of yours` : ""}` };
  if (work) {
    try {
      await io.api(`/remote-work/${encodeURIComponent(work.id)}/chat`, { method: "POST", body: { chat } });
    } catch (/** @type {any} */ e) {
      return { ok: false, words: `The chat started on ${place.name}, and could not be named here, so what it changes cannot come back: ${line(e?.message || e, 300)}` };
    }
  }
  return turnThere(place, { chat, work }, text, io);
}

/**
 * The message sent in the chat started there, and the chat opened in place. One that surely did not go is the
 * person's to send again (`started`: its chat stands there, the next send goes to it), nothing opened; one whose answer
 * never came may have gone (`unsure`), and the chat opens for the person to look.
 * @param {Place} place @param {{ chat: string, work: any | null }} started @param {string} text
 * @param {{ call: (p: any) => Promise<any>, open: (machine: { id: string, name: string }, chat: string) => void }} io
 * @returns {Promise<{ ok: true, chat: string, work: any | null, unsure?: string } | { ok: false, words: string, started: { chat: string, work: any | null } }>}
 */
async function turnThere(place, started, text, io) {
  const sent = await io.call({ op: "turn", machine: place.id, chat: started.chat, content: text });
  if (!sent?.ok && !sent?.unsure) return { ok: false, words: `Your chat stands on ${place.name}, and your message did not go: ${line(sent?.words, 300) || "it did not answer"}. Send it again to send it there, or pick another in Run on`, started };
  io.open({ id: place.id, name: place.name }, started.chat);
  return { ok: true, ...started, ...(sent?.ok ? {} : { unsure: line(sent?.words, 300) || `${place.name} did not answer` }) };
}
