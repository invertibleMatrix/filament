// @ts-check
// `@mem …` typed in any chat (API model or agent, Filament's or an outside client's): answered by Filament, the
// upstream is not called. The memory service parses and answers the command; this records and delivers the answer.
import { answerWith, openCommandRecord } from "./answer.js";
import { clip } from "../../core/text.js";
import { leftOutWords } from "../../services/memory/goal.js";
import { allowsAlways } from "../../services/memory/permissions.js";

/**
 * @param {import("../pipeline/context.js").RequestContext} ctx
 * @param {import("../deps.js").AppDeps} deps
 * @param {{ text: string, chainId?: string | null, card?: any }} memCmd  what `memory.command` answered
 */
export function answerMemCommand(ctx, deps, memCmd) {
  const rec = openCommandRecord(ctx, deps, { upstream: ctx.route.upstream });
  rec.memory = { chain: memCmd.chainId || undefined, command: true, client: ctx.memory.sit.client };
  answerWith(ctx, deps, rec, memCmd.text, {
    changes: ["memory command answered by Filament, upstream not called"],
    local: true,
    card: memCmd.card,
  });
}

/**
 * `@mem …` in a chat Filament composes that Memory settings leave out (`ctx.memory.kept`): Filament answers it itself,
 * in the setting's words (goal.js `leftOutWords`), on the chat's command turn — memory shows, keeps and changes
 * nothing there, and nothing reaches the model. One in a turn whose situate failed (`kept.missed`) says memory could not
 * read the chat for this message, and to send it again, as /goal says it.
 * @param {import("../pipeline/context.js").RequestContext} ctx
 * @param {import("../deps.js").AppDeps} deps
 * @param {{ prefix: string, verb: string }} head  the command as `memCommandHead` read it
 */
export function answerMemLeftOut(ctx, deps, { prefix, verb }) {
  const kept = ctx.memory.kept;
  const missed = !kept?.leftOut && !!kept?.missed;
  const rec = openCommandRecord(ctx, deps, { upstream: ctx.route.upstream });
  rec.memory = { chain: kept?.chainRef || undefined, command: true, client: kept?.client };
  const text = `${leftOutWords(kept?.leftOut || true, missed)}, and \`${prefix}\` is memory's: \`${prefix} ${verb}\` shows, keeps and changes nothing ${missed ? "— send it again" : "here"}.`;
  answerWith(ctx, deps, rec, text, { changes: [missed ? "memory command answered by Filament in a turn memory could not read, upstream not called" : "memory command answered by Filament in a chat Memory settings leave out, upstream not called"], local: true });
}

// ---- chat commands --------------------------------------------------------------------------------
// Returns { text } when the message is a command Filament answers itself, else null.
/** @param {any} memory @param {string} text @param {any} sit */
export async function memoryCommand(memory, text, sit) {
  const head = sit ? memCommandHead(memory, text) : null;
  return head ? answerMemHead(memory, head, sit) : null;
}

/**
 * The answer to an `@mem` command already read (memCommandHead), on the request's memory trace when it has one.
 * @param {any} memory @param {{ prefix: string, verb: string, arg: string, more?: string }} head @param {any} sit
 */
export function answerMemHead(memory, { prefix, verb, arg, more = "" }, sit) {
  const tr = sit.trace || null;
  if (tr)
    return tr.span(
      `memory command ${prefix} ${verb}`,
      () => answerMemVerb(memory, { sit, prefix, verb, arg, more }),
      {
        note: "answered by Filament; the upstream is not called",
      },
    );
  return answerMemVerb(memory, { sit, prefix, verb, arg, more });
}

/**
 * The `@mem` command a message opens with — its prefix, verb and argument, and `more`, the lines under it (what a keep
 * verb keeps with its argument: a procedure's steps, one a line) — or null: the commands are off, memory is closed, or
 * the first line does not open with the prefix. A bare prefix is `help`.
 * @param {any} memory @param {string} text
 * @returns {{ prefix: string, verb: string, arg: string, more?: string } | null}
 */
export function memCommandHead(memory, text) {
  const c = memory.cfg().commands || {};
  if (c.enabled === false || !memory.isOpen()) return null;
  const prefix = String(c.prefix || "@mem").trim();
  const [head, ...under] = String(text || "")
    .trim()
    .split(/\n/);
  const first = head.trim();
  if (!first.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const m = /^(\w+)\s*(.*)$/s.exec(first.slice(prefix.length).trim());
  const more = under.join("\n").trim();
  return { prefix, verb: (m?.[1] || "help").toLowerCase(), arg: (m?.[2] || "").trim(), ...(more ? { more } : {}) };
}

/**
 * Whether an `@mem` command already read (`memCommandHead`) makes an Always allow (permissions.js `allowsAlways`): an
 * always-allow offer confirmed, or given new words. The Memory page's rows refuse that this computer's caller without
 * the desktop app's key, and so is the chat that types it (sessions/service.js, beside `/set`; s-rows, 11-12). Its id
 * and its words are read as `answerMemVerb` reads them; an id that names no memory, and memory closed, make none.
 * @param {any} memory @param {{ verb: string, arg: string, more?: string }} cmd
 */
export function memAsksLess(memory, { verb, arg, more = "" }) {
  if (verb !== "confirm" && verb !== "correct") return false;
  const [id, ...rest] = arg.split(/\s+/);
  if (!id) return false;
  let claim = null;
  try {
    claim = memory.scope({ role: "person" }).claim(id);
  } catch {
    return false;
  }
  return allowsAlways(claim, verb === "confirm" ? { confirm: true } : { text: [rest.join(" "), more].filter(Boolean).join("\n") });
}

/**
 * @param {any} memory @param {{ sit: any, prefix: string, verb: string, arg: string, more?: string }} o
 * @returns {Promise<{ text: string, chainId?: string | null, verb?: string, card?: any }>}
 */
async function answerMemVerb(memory, { sit, prefix, verb, arg, more = "" }) {
  let card = null; // a settings change's card, captured by whichever branch wrote (Facade D4)
  // The creator (D6): every path that births a chain goes through it — a first message that is an @mem command
  // births the chain like any other.
  const chain = memory.chainFor?.(sit);
  if (!chain) throw new Error(`no archive: ${memory.archiveWhy()}`);
  // The person in the chat, standing in this session: what they store is their word, filed in this project. A chat whose
  // client reaches its own project's sessions alone (`sit.confined`) searches, lists and loads those.
  const me = memory.scope({ role: "person", project: sit.project.id === "none" ? null : sit.project.id, chain: chain.id, client: sit.client, confined: !!sit.confined });
  const noSession = (/** @type {string} */ ref) => ({ text: `No session ${ref}${me.confined ? " in this project's memory" : ""}. Run \`${prefix} sessions <words>\` first.` });
  const lines = [];
  try {
    if (verb === "status") {
      const st = await memory.status();
      const eng = st.engine || {};
      lines.push(
        `**Memory status** (Filament)`,
        ...(st.enabled ? [] : ["- memory is **off** in Memory settings: turns are recorded; nothing is recalled or learned and no memory tools are offered (a session's goal still rides)"]),
        `- engine: ${eng.installed || eng.state === "ready" ? `Mnemosyne ${eng.version || ""} (${eng.state})` : "not installed"}${eng.embeddings === true ? ", embeddings on" : eng.embeddings === false ? ", keyword recall only" : ""}`,
        `- memories: ${eng.counts?.working ?? "?"} · sessions archived: ${st.archive?.chains ?? 0} · turns: ${st.archive?.turns ?? 0}`,
        `- this session: ${chain.id}${chain.meta?.muted ? " (memory off here)" : ""}, project ${sit.project.name || "none"}, ${chain.turns || 0} turns so far`,
        `- autopilot: ${memory.cfg().autopilot?.enabled === false ? "off" : memory.cfg().autopilot?.mode || "conservative"}; tools ${memory.cfg().autopilot?.tools === false ? "off" : "on"}`,
      );
    } else if (verb === "recall" || verb === "search") {
      if (!arg) return { text: `Usage: ${prefix} recall <words>` };
      const items = await me.search(arg, { limit: 10 });
      lines.push(
        `**Memory for “${clip(arg, 60)}”** (${items.length} result${items.length === 1 ? "" : "s"})`,
      );
      for (const it of items)
        lines.push(
          `- [${it.kind}${it.when ? ` ${it.when}` : ""}${it.chainId ? ` · session ${it.chainId}` : ""}] ${clip(it.text, 240)}  \`${it.id}\``,
        );
      if (!items.length)
        lines.push(
          "Nothing matched. Try other keywords, or `" +
            prefix +
            " sessions <words>` to search past sessions.",
        );
    } else if (verb === "sessions") {
      const list = me.sessions(arg, { limit: 10 });
      memory.sessionLists.set(
        sit.key,
        list.map((s) => s.id),
      );
      if (memory.sessionLists.size > 300) memory.sessionLists.delete(memory.sessionLists.keys().next().value);
      lines.push(arg ? `**Sessions matching “${clip(arg, 60)}”**` : "**Recent sessions**");
      list.forEach((s, i) =>
        lines.push(
          `${i + 1}. \`${s.id}\` ${s.title ? `“${clip(s.title, 60)}”` : "untitled"} — ${s.when || ""}${s.client ? `, ${s.client}` : ""}${s.turns ? `, ${s.turns} turns` : ""}${s.continues ? ` · continues ${String(s.continues).slice(0, 8)}` : ""}${s.state ? ` — ${clip(s.state, 120)}` : ""}${s.matches?.length ? `\n   ↳ ${s.matches.map((x) => `turn ${x.n}: ${clip(x.snippet, 100)}`).join(" · ")}` : ""}`,
        ),
      );
      if (!list.length) lines.push("No sessions found.");
      else lines.push(`Load one: \`${prefix} load <number or id> [chat|summary|full|compact|lineage]\``);
    } else if (verb === "load") {
      const [ref, view] = arg.split(/\s+/);
      if (!ref) return { text: `Usage: ${prefix} load <number or id> [chat|summary|full|compact|lineage]` };
      const ids = memory.sessionLists.get(sit.key) || [];
      const id = /^\d+$/.test(ref) ? ids[Number(ref) - 1] : ref;
      if (!id || !memory.archive.getChain(id) || !me.reaches(id)) return noSession(ref);
      const v = ["chat", "summary", "full", "compact", "lineage"].includes(view) ? view : "chat";
      const r = me.load(id, { view: v, budgetTokens: 6000 });
      memory.pendingLoads.set(sit.key, { chainId: id, view: v });
      const ch = memory.archive.getChain(id);
      // It rides the first message memory speaks into (brain.js): while memory stays out of this chat, it waits — each
      // reason said, so turning one of them back on is not taken for the end of the wait.
      const off = memory.cfg().enabled !== true;
      const noAutopilot = memory.cfg().autopilot?.enabled === false;
      const held = [
        chain.meta?.muted ? `memory is off in this chat (\`${prefix} on\` turns it back on)` : "",
        off && noAutopilot
          ? "memory and its autopilot are off in Memory settings"
          : off
            ? "memory is off in Memory settings"
            : noAutopilot
              ? "autopilot is off in Memory settings"
              : "",
        sit.quiet ? "this client asks memory to stay out of its requests (x-filament-memory: off)" : "",
      ]
        .filter(Boolean)
        .join(" and ");
      lines.push(
        `Loaded ${v === "lineage" ? `the lineage of \`${id}\` (${r.sessions ?? "?"} sessions, oldest first)` : `session \`${id}\`${ch.title ? ` “${clip(ch.title, 60)}”` : ""}`} (${v} view, ${r.turns ?? "?"} turn${r.turns === 1 ? "" : "s"}, ~${r.tokens ?? "?"} tokens). ${held ? `It waits while ${held}, then rides your next message here.` : "It is pasted into your next message in this chat; just ask."}`,
      );
    } else if (verb === "remember" || verb === "rule" || verb === "prefer" || verb === "procedure") {
      // The command names the kind, never the words (the memory plan's d3): remember keeps a fact, rule a rule, prefer a
      // preference, procedure a way to do a thing (HarnessV3-Memory M5-6), which must read "How to <goal>: 1. … 2. …" —
      // its steps on the lines under it too.
      const kept = [arg, more].filter(Boolean).join("\n");
      if (!kept) return { text: `Usage: ${prefix} ${verb} ${verb === "procedure" ? "How to <goal>: 1. <step> 2. <step>" : "<text>"}` };
      const kind = verb === "rule" ? "rule" : verb === "prefer" ? "preference" : verb === "procedure" ? "procedure" : "fact";
      const r = await me.remember(kept, { kind, importance: 0.85 });
      lines.push(
        `Stored as a ${kind} (\`${r.id}\`)${r.restored ? " — you had dismissed it; it stands again" : ""}${r.replaced ? ` — it replaces ${r.replaced.map((/** @type {string} */ x) => `\`${x}\``).join(", ")}` : ""}.${r.note ? ` (${r.note})` : ""}`,
      );
    } else if (verb === "forget") {
      if (!arg) return { text: `Usage: ${prefix} forget <id>` };
      const r = await me.forget(arg, { reason: "the user asked to forget it" });
      lines.push(
        r.ok ? `Forgot \`${arg}\` (kept as history, no longer served).` : `Could not forget \`${arg}\`${r.error ? `: ${r.error}` : ""}.`,
      );
    } else if (verb === "confirm") {
      // The person's word that a memory is right (HarnessV3-Memory M6-3): it counts as theirs from now on.
      const id = arg.split(/\s+/)[0];
      if (!id) return { text: `Usage: ${prefix} confirm <id>` };
      const r = await me.confirm(id);
      lines.push(r.ok ? (r.unchanged ? `\`${r.id}\` is confirmed already.` : `Confirmed \`${r.id}\`: it counts as your word now.`) : `Could not confirm \`${id}\`: ${r.error}.`);
    } else if (verb === "correct") {
      // New words for a memory (M6-3): they replace it, as your correction; the sessions shown the old one hear of it.
      const [id, ...rest] = arg.split(/\s+/);
      const text = [rest.join(" "), more].filter(Boolean).join("\n").trim();
      if (!id || !text) return { text: `Usage: ${prefix} correct <id> <what is true now>  (${prefix} forget <id> retires one with nothing in its place)` };
      const r = await me.correct(id, { text, reason: "the user corrected it in the chat" });
      lines.push(r.ok ? `Corrected: \`${r.id}\` replaces \`${r.replaces}\`.` : `Could not correct \`${id}\`: ${r.error}.`);
    } else if (verb === "history") {
      if (!arg) return { text: `Usage: ${prefix} history <id>` };
      const h = me.history(arg.split(/\s+/)[0]);
      if (h.error) lines.push(`No history for \`${arg}\`: ${h.error}.`);
      else {
        lines.push(
          `**History of \`${h.id}\`** (${h.kind}, ${h.status}${h.trust ? `, ${h.trust}` : ""})`,
          `> ${clip(h.text, 400)}`,
        );
        if (h.slot) lines.push(`Slot: ${h.slot}${h.value ? ` = ${clip(h.value, 120)}` : ""}`);
        for (const e of h.events)
          lines.push(
            `- ${e.at ? e.at.slice(0, 16).replace("T", " ") : "?"} — ${e.action === "evidence" ? `said again in session ${e.detail?.chain ?? "?"}` : e.action}${e.by ? ` by ${e.by}` : ""}${e.reason ? `: ${clip(e.reason, 160)}` : ""}`,
          );
        if (h.replaces.length) lines.push(`Replaced ${h.replaces.map((x) => `\`${x}\``).join(", ")}.`);
        if (h.replacedBy) lines.push(`Replaced by \`${h.replacedBy}\`.`);
      }
    } else if (verb === "curate") {
      lines.push(...curateReply(await me.curate(), prefix));
    } else if (verb === "inbox" || verb === "questions") {
      const qs = me.questions();
      if (!qs.length) lines.push("Memory has no open questions for you.");
      else {
        lines.push(`**Memory's questions** (${qs.length}) — \`${prefix} accept <q>\` does what it proposes, \`${prefix} reject <q>\` closes it for good:`);
        for (const q of qs) lines.push(questionLine(q));
      }
    } else if (verb === "accept" || verb === "reject") {
      if (!arg) return { text: `Usage: ${prefix} ${verb} <q>  (the questions: ${prefix} inbox)` };
      const r = await me.decide(arg.split(/\s+/)[0], verb);
      lines.push(
        !r.ok
          ? `Could not ${verb} \`${arg.split(/\s+/)[0]}\`: ${r.error}.`
          : verb === "accept"
            ? `Done: \`${r.id}\` accepted${r.result ? ` (\`${r.result}\`)` : ""}.`
            : `Closed \`${r.id}\`: memory will not ask it again.`,
      );
    } else if (verb === "undo") {
      if (!arg) return { text: `Usage: ${prefix} undo <r>  (a curator pass, as \`${prefix} curate\` names it)` };
      const r = await me.undo(arg.split(/\s+/)[0]);
      lines.push(
        !r.ok
          ? `Could not undo \`${arg.split(/\s+/)[0]}\`: ${r.error}.`
          : r.already
            ? `\`${r.run}\` is undone already.`
            : `Undid \`${r.run}\`: ${r.undone} action${r.undone === 1 ? "" : "s"} put back${r.skipped.length ? `; ${r.skipped.length} left as they are, since their memory changed after it (${r.skipped.map((/** @type {any} */ s) => `\`${s.id}\` ${s.why}`).join("; ")})` : ""}.`,
      );
    } else if (verb === "off" || verb === "on") {
      // The document's own knob (D8), written through the one writer so the chain's muted flag follows it.
      const r =
        verb === "off"
          ? memory.patchSessionSettings(chain.id, { patch: { memory: { enabled: false } } }, { via: `${prefix} off`, card: true })
          : memory.patchSessionSettings(chain.id, { unset: ["memory.enabled"] }, { via: `${prefix} on`, card: true });
      card = r.card; // the change card rides the shared return (Facade D4)
      if (r.errors?.length) lines.push(`Memory command failed: ${r.errors.join("; ")}`);
      else if (verb === "off")
        lines.push(
          "Memory is off for this chat: nothing is recalled into it and nothing is learned from it (the archive still records).",
        );
      else {
        // The session follows your global setting again; when the global switch is off too, say so.
        const stillOff = memory.enabled?.() === false;
        lines.push(
          stillOff
            ? "This chat follows your settings again — but memory is off globally (Memory settings): turns are recorded, nothing is recalled or learned, until you switch it back on."
            : "Memory is on again for this chat.",
        );
      }
    } else if (verb === "new") {
      // A chat of the harness's own names its session by id, which no key moves: it goes on as itself. Any other chat's
      // session goes under a closed key, its turns kept: the chat's next message births a fresh chain.
      if (memory.archive.chainHead(chain.id)?.native) {
        // New chat's key is Ctrl+N in the desktop app alone (a browser tab keeps Ctrl+N: the owner's of 11-09).
        lines.push("This chat is one of the harness's own: it goes on as this session. A new chat (New chat, at the top of the left bar) starts fresh.");
      } else {
        memory.archive.rekeyChain(chain.id, `${sit.key}#closed-${memory.now().toString(36)}`);
        lines.push(
          "This chat continues as a new session for memory: the next message starts a fresh chain with a fresh briefing. Where its agent loads a session of this folder in that first turn, it is linked to that session, as any new session is.",
        );
      }
    } else {
      lines.push(
        `**Memory commands** (${prefix})`,
        `- \`${prefix} status\` — engine, counts, this session`,
        `- \`${prefix} recall <words>\` — search memory`,
        `- \`${prefix} sessions <words>\` — find past sessions by what you typed (no words = recent)`,
        `- \`${prefix} load <n|id> [chat|summary|full|compact|lineage]\` — paste a past session (lineage = it plus all its ancestors, oldest first) into your next message`,
        `- \`${prefix} remember <text>\` — keep a fact · \`${prefix} rule <text>\` — a rule · \`${prefix} prefer <text>\` — a preference · \`${prefix} procedure How to <goal>: 1. … 2. …\` — a way to do a thing`,
        `- \`${prefix} forget <id>\` · \`${prefix} history <id>\` — who changed a memory, when and why`,
        `- \`${prefix} confirm <id>\` — a memory is right: it counts as your word · \`${prefix} correct <id> <text>\` — what is true now replaces it`,
        `- \`${prefix} curate\` — tidy this project's memory now (merge what says the same, key values, check memories whose files changed, judge what sessions found may be wrong, write the dossier); \`${prefix} undo <r>\` puts a pass back`,
        `- \`${prefix} inbox\` — memory's questions for you; \`${prefix} accept <q>\` · \`${prefix} reject <q>\``,
        `- \`${prefix} off\` / \`${prefix} on\` — memory for this chat`,
        `- \`${prefix} new\` — start a fresh memory session here (in a chat of the harness's own: New chat)`,
      );
    }
  } catch (/** @type {any} */ e) {
    lines.push(`Memory command failed: ${e.message.slice(0, 200)}`);
  }
  return { text: lines.join("\n"), chainId: chain.id, card };
}

/**
 * What a curator pass did, in words (HarnessV3-Memory M4): each kind of action counted, the questions it raised, its
 * model calls, and how to undo it. @param {any} r  the pass, as `MemoryCurator.run` returns it @param {string} prefix
 * @returns {string[]}
 */
function curateReply(r, prefix) {
  if (r?.skipped) return [`The curator did not run: ${r.skipped}.`];
  const n = (/** @type {any} */ v) => Number(v) || 0;
  const s = (/** @type {number} */ k, /** @type {string} */ one, /** @type {string} */ many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const did = [
    ...(n(r.merged) ? [`merged ${s(n(r.merged), "memory", "memories")} into the one saying the same thing`] : []),
    ...(n(r.keyed) ? [`keyed ${s(n(r.keyed), "value")}, so a newer value replaces the older${n(r.slotRetired) ? `; ${n(r.slotRetired)} older ${n(r.slotRetired) === 1 ? "value" : "values"} retired` : ""}`] : []),
    ...(n(r.verified) || n(r.wrong) || n(r.unsure) ? [`checked ${s(n(r.verified) + n(r.wrong) + n(r.unsure), "memory", "memories")} against ${n(r.verified) + n(r.wrong) + n(r.unsure) === 1 ? "its" : "their"} changed files: ${[n(r.verified) ? `${n(r.verified)} still ${n(r.verified) === 1 ? "holds" : "hold"}` : "", n(r.wrong) ? `${n(r.wrong)} retired` : "", n(r.unsure) ? `${n(r.unsure)} unsettled` : ""].filter(Boolean).join(", ")}`] : []),
    ...suspicionsLine(r),
    ...(n(r.grounded) || n(r.groundWrong) || n(r.groundUnsure) || n(r.groundAsked)
      ? [`checked ${s(n(r.grounded) + n(r.groundWrong) + n(r.groundUnsure) + n(r.groundAsked), "memory", "memories")} against the turns they came from: ${[n(r.grounded) ? `${n(r.grounded)} borne out` : "", n(r.groundWrong) ? `${n(r.groundWrong)} retired` : "", n(r.groundAsked) ? `${n(r.groundAsked)} asked about` : "", n(r.groundUnsure) ? `${n(r.groundUnsure)} unsettled` : ""].filter(Boolean).join(", ")}`]
      : []),
    ...(n(r.gone) ? [`retired ${s(n(r.gone), "memory", "memories")} whose files are gone`] : []),
    ...(n(r.expired) ? [`retired ${s(n(r.expired), "open thread")} no session took up`] : []),
    ...(n(r.lapsed) ? [`retired ${s(n(r.lapsed), "finding")} sessions were shown and none used`] : []),
    ...(n(r.adoptAsked) ? [`asked whether to keep ${s(n(r.adoptAsked), "rule")} the same correction in several sessions suggests`] : []),
    ...(n(r.everywhereAsked) ? [`asked whether to keep ${s(n(r.everywhereAsked), "thing", "things")} about you in every project`] : []),
    ...(n(r.adoptChange) ? [`asked whether to change ${s(n(r.adoptChange), "rule")} of yours the same correction in several sessions says otherwise`] : []),
    ...(typeof r.dossier === "string" && /^v\d+$/.test(r.dossier)
      ? [`wrote the project's dossier (${r.dossier})${n(r.dossierUnused) ? `, leaving out ${s(n(r.dossierUnused), "memory", "memories")} sessions' briefings showed and none used (search still finds them)` : ""}`]
      : []),
  ];
  const head = `**Curated ${r.project ? "this project" : "the global memories"}** (pass \`${r.run}\`, ${s(n(r.calls), "model call")}${r.model ? ` on \`${r.model}\`` : ", no model"})`;
  return [
    head,
    ...(did.length ? did.map((x) => `- ${x}`) : ["- nothing needed changing"]),
    ...(n(r.questions) ? [`- ${s(n(r.questions), "question")} for you: \`${prefix} inbox\``] : []),
    ...(r.stopped ? [`- stopped calling the model: out of ${r.stopped}`] : []),
    ...(r.errors ? Object.entries(r.errors).map(([k, v]) => `- the ${k} step failed: ${v}`) : []),
    ...(r.error ? [`- the pass failed: ${r.error}`] : []),
    ...(n(r.actions) ? [`Undo all of it: \`${prefix} undo ${r.run}\`.`] : []),
  ];
}

/**
 * The suspicions a curator pass judged (M7-D68: what sessions found may be wrong, d4), as `curateReply`'s line: none
 * when it judged none.
 * @param {any} r  the pass @returns {string[]}
 */
function suspicionsLine(r) {
  const [cleared, wrong, asked, weighed] = [r.suspicionsCleared, r.suspicionsWrong, r.suspicionsAsked, r.suspicionsWeighed].map((v) => Number(v) || 0);
  const all = cleared + wrong + asked + weighed;
  if (!all) return [];
  const parts = [cleared && `${cleared} cleared`, wrong && `${wrong} retired`, asked && `${asked} asked about`, weighed && `${weighed} left standing`].filter(Boolean);
  return [`judged ${all} ${all === 1 ? "memory" : "memories"} sessions found may be wrong: ${parts.join(", ")}`];
}

/** One of memory's questions, as a line. @param {any} q */
function questionLine(q) {
  const p = q.proposal || {};
  const said = (/** @type {string} */ ref) => {
    const c = q.claims.find((/** @type {any} */ x) => x.id === ref);
    return c ? ` "${clip(c.text, 120)}"` : "";
  };
  const what =
    p.action === "restore"
      ? `bring back, as a ${p.kind}: "${clip(p.text, 160)}"`
      : p.action === "adopt"
        ? `keep as your ${p.kind || "rule"}: "${p.text}"`
      : p.action === "correct" && p.replacement == null
        ? `change \`i${p.id}\`${said(`i${p.id}`)} to: "${p.text}"`
      : p.action === "everywhere"
        ? `keep about you, in every project: "${p.text}"`
      : p.action === "bring-back"
        ? `bring back your word \`i${p.replacement}\`${said(`i${p.replacement}`)}${p.id != null ? ` in place of \`i${p.id}\`${said(`i${p.id}`)}` : ""}`
        : p.replacement
          ? `replace \`i${p.id}\`${said(`i${p.id}`)} with \`i${p.replacement}\`${said(`i${p.replacement}`)}`
          : `retire \`i${p.id}\`${said(`i${p.id}`)}`;
  return `- \`${q.id}\` ${what} — ${clip(q.reason, 200)}`;
}
