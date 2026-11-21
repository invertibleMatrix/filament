// @ts-check
// A flow's runner (HarnessV4_Flow_Plan F3; HarnessV4_OneAgent_Plan OA3): the person's agents and teams in steps beside
// a chat. The main agent drafts one with its flow tool once the person asks with `/flow` (`asked`, `draftBy`), and
// changes the draft it drew while it stands (`editBy`); the person drafts one by hand or from a saved flow, changes any
// draft, and Start is theirs alone (L26: Filament never runs a flow the person did not start). Start runs the first
// step's boxes and tells the main agent the flow as it stands (OA-D8); a step starts once every box of the step before it
// is done or skipped; each box is handed the person's words and the results of the boxes it needs (core/flow.js
// `boxAsk`). An agent box is a sub-agent of the person's (`origin: "flow"`) at its card's level, or reads only where
// drawn so: it takes their seats and waits for one where none is free; its end is its launch's `done`. A team box is a
// team fired beside the chat (`by: "flow"`): its end is read off its chat as teams beside say it changed — the reply its
// lead ended on, kept (FL-D18). The person's review asks them as its step starts: Go on, Send back to a box it needs,
// Stop. A gate's "not yet" — or no verdict — holds the flow and asks the person: Send back to a box it needs (a
// follow-up, else a fresh start, or a new turn in a team's chat), Go on anyway, Stop. A box that fails or is stopped
// holds it too: Retry, Skip, Stop. After a restart nothing goes on by itself (FL-D19): a running flow says "Stopped by a
// restart", with Go on. At the end one message reaches the main agent where the person left that on, kept with the flow
// until it went (FL-D11). Each change is said on the `turns` topic (`{ type: "flow", chainId, id, state }`), which the
// page follows.
// In place (OA4), Start opens a turn of the main agent that drives the flow: every turn of its chat owes the flow while
// it runs (`drives`, which the registry's door waits on), and what moved reaches the agent as one word a burst
// (`newsOf`), into its running turn. With its flow tool it stops, skips or retries a box, answers a gate or leaves it to
// the person, edits the steps to come, or stops the flow (`actBy`, `editBy`); the person's review stays theirs. Stop on
// that turn stops the flow; a turn that fails or ends before the flow does leaves it holding, and the person goes on
// beside the chat. After a restart the turn goes on by itself, told what the restart cut. Every act on a running flow —
// the person's or the agent's — is kept on it (`acts`).
import { randomUUID } from "node:crypto";
import { possessive } from "../core/text.js";
import { TEAMS_OFF_WHY } from "../core/teams-on.js";
import { BOX_WORDS, FLOW_GO_ON, FLOW_LIMITS, REVIEW_NAME, backAsk, boxAsk, boxOf, boxesOf, brokenNeeds, checkFlow, driveNotice, endEnvelope, endMessage, endsAsking, flowLine, flowOf, flowText, lineOf, live, newsMark, newsOf, noteAct, ownName, passed, restartNotice, reviewResult, rosterWords, seatsOf, startNotice, stepAt, verdictOf, writes } from "../core/flow.js";

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });
/** @param {unknown} s */
const clean = (s) => String(s ?? "").replace(/\r\n?/g, "\n").trim();
/** How much of a box's result a flow's card carries; Open reads it whole. */
const CARD_RESULT = 4000;
/** What a team box that is gone on with after a restart, a stop or a failure is told (core/flow.js FLOW_GO_ON). */
export const GO_ON_LINE = FLOW_GO_ON;
/** How many of a chat's flows the flow tool's read says. */
const READ_FLOWS = 5;

/**
 * @typedef {import("../core/flow.js").Flow} Flow
 * @typedef {import("../core/flow.js").FlowBox} FlowBox
 * @typedef {import("../core/flow.js").Roster} Roster
 * @typedef {{ chainId: string, fid: string, bid: string }} BoxRef
 * @typedef {{ goal: string, at: number, drafted: string | null }} FlowAsk  the person's newest message was `/flow`: its
 *   words, when, and the draft this ask drew — a second draft in it replaces that one
 * @typedef {{ by: "person" | "agent", why?: string }} By  who acts on a running flow: the person, or the main agent that
 *   drives it In place (OA4), with its why
 */

/** The person's own press: every route's act. @type {By} */
const PERSON = Object.freeze({ by: "person" });

/** A flow's steps as an edit or a saved flow takes them: each box's own fields, none of its run. @param {Pick<Flow, "steps">} flow */
export const stepsInput = (flow) => flow.steps.map((s) => ({ why: s.why, boxes: s.boxes.map((b) => ({ id: b.id, kind: b.kind, agent: b.agent, words: b.words, needs: [...b.needs], gate: b.gate, readOnly: b.readOnly, model: b.model, ...(b.effort ? { effort: b.effort } : {}), sees: b.sees })) }));

/**
 * The main agent's steps, sent whole, keep what the person picked for each box it names again (the owner's of 11-05):
 * the flow tool's boxes carry no model, effort or reading, so a box whose id, kind and agent stand as they were keeps
 * the old box's where the agent's names none. A box moved to another agent takes none: they were picked for the other.
 * Only an id the agent sent matches: one flowOf numbered in place of an id it cannot keep is a new box (the review of
 * 7f95cc28e: b1 is whichever box comes first). The steps read as flowOf reads them: a step's boxes, or the step a list.
 * @param {Flow["steps"]} steps  as flowOf made them @param {unknown} sent  the steps as the agent sent them
 * @param {Pick<Flow, "steps">} was @returns {Flow["steps"]}
 */
export const keepPicks = (steps, sent, was) => {
  const old = new Map(was.steps.flatMap((s) => s.boxes).map((b) => [b.id, b]));
  /** @type {Map<string, any>} */
  const raw = new Map((Array.isArray(sent) ? sent : []).flatMap((/** @type {any} */ s) => (Array.isArray(s?.boxes) ? s.boxes : Array.isArray(s) ? s : [])).map((/** @type {any} */ x) => [String(x?.id ?? "").trim().toLowerCase(), x]));
  for (const b of steps.flatMap((s) => s.boxes)) {
    const o = old.get(b.id);
    const x = raw.get(b.id);
    if (!o || !x || b.kind === "review" || o.kind !== b.kind || o.agent !== b.agent) continue;
    if (x.model == null && o.model) b.model = o.model;
    if (x.effort == null && o.effort) b.effort = o.effort;
    if (x.sees == null && o.sees) b.sees = o.sees;
  }
  return steps;
};

/** A send-back that names the person's review: it has no run to go again, so a box that works is named instead. */
const NO_REVIEW_BACK = "a review is not sent back: it has no run of its own — send back a box it needs that works";

/**
 * @param {{ store: import("../services/flow-store.js").FlowStore, archive: () => any, registry: () => any, besides: () => any,
 *   sessions: { besideFacts: (id: string) => any, leadFacts?: (id: string) => { usd: number } },
 *   roster: () => Roster, postTurn: (chainId: string, body: Record<string, unknown>) => Promise<{ status: number, body: any }>,
 *   events: { publish: (topic: string, msg: any) => void, subscribe?: (topic: string, fn: (msg: any) => void) => () => void },
 *   alert?: (text: string, key: string) => void, log?: (level: string, msg: string) => void, now?: () => number, newId?: () => string,
 *   saved?: import("../services/saved-flows.js").SavedFlows | null, here?: (folder: string) => boolean,
 *   uncommittedOf?: ((chainId: string) => Promise<import("../adapters/git/places.js").LeftBehind>) | null, teamsOn?: () => boolean }} o
 *   `registry`: the sub-agents' registry; `besides`: teams beside a chat (app/teams-beside.js); `postTurn`: a turn
 *   through the route a message takes, into a team box's own chat; `alert`: the alerts every page shows; `saved`: the
 *   person's saved flows (F6); `here`: whether a folder is still there — the flow's worktree, before a box works in it;
 *   `uncommittedOf`: how many uncommitted files a worktree made from a chat's folder leaves there (`count` null where
 *   none is made), or that git could not tell; `teamsOn`: Settings › Experimental's Teams switch (core/teams-on.js) —
 *   off, a flow drawn, drafted, changed or started takes no team box that has not started, and the roster the page and
 *   the main agent read for a new box holds no team; `roster` stays whole for the flows that run
 */
export function createFlowRunner({ store, archive, registry, besides, sessions, roster, postTurn, events, alert = () => {}, log = () => {}, now = Date.now, newId = () => `fl-${randomUUID().slice(0, 8)}`, saved = null, here = () => true, uncommittedOf = null, teamsOn = () => true }) {
  /** The sub-agents running a flow's box, by id. @type {Map<string, BoxRef>} */
  const subs = new Map();
  /** The team chats running a flow's box, by id. @type {Map<string, BoxRef>} */
  const teamChats = new Map();
  /** The flows whose end message waits for its chat's turn to end now. @type {Set<string>} */
  const endWaits = new Set();
  /** The holds and questions already alerted, so each alerts once. @type {Set<string>} */
  const alerted = new Set();
  /** What the main agent was last told of each flow it drives (OA4), by flow. @type {Map<string, import("../core/flow.js").NewsMark>} */
  const told = new Map();
  /** The driven flows whose news goes once the burst of changes that moved them is over. @type {Set<string>} */
  const newsDue = new Set();
  /** What each chat's turns wait on while it drives a flow: let go once none is driven. @type {Map<string, { p: Promise<void>, done: () => void }>} */
  const drivesOwed = new Map();
  /**
   * The fire still making a flow's worktree (OA5), by flow: a box that writes waits for it to end, then works where it
   * made it — one worktree a flow, whatever was skipped or stopped while a lead started.
   * @type {Map<string, Promise<void>>}
   */
  const placing = new Map();
  let closedDown = false;

  /**
   * The flows at work now, every chat's, by id (the owner's of 10-28: a chat stays under Now's Working while a flow of
   * its runs, its turn over): each running or holding one, its line, and whether it asks the person. Read from the store
   * the first time it is asked, then kept as each flow changes.
   * @type {Map<string, FlowAtWork> | null}
   */
  let atWork = null;
  /** @param {Flow} flow */
  const keepAtWork = (flow) => {
    if (!atWork) return;
    // A flow a restart cut waits for your Go on (FL-D19): it asks you, as a hold does (the Hunter's of 10-28).
    if (flow.state !== "running" && flow.state !== "holds" && flow.state !== "cut") return void atWork.delete(flow.id);
    const boxes = boxesOf(flow).map((x) => x.box);
    const asking = boxes.find((b) => b.state === "asking") || null;
    const asks = flow.state === "holds" || flow.state === "cut" || !!asking;
    // Since when: the flow's start; one that asks, since its ask — the box asking, else the newest end that held it.
    const held = Math.max(0, ...boxes.map((b) => Number(b.endedAt) || 0));
    const at = (asking ? Number(asking.startedAt) : flow.state === "holds" ? held : 0) || Number(flow.startedAt) || now();
    atWork.set(flow.id, { chainId: flow.chainId, id: flow.id, state: flow.state, line: flowLine(flow), asks, at });
  };
  /** @param {Flow} flow */
  const said = (flow) => {
    keepAtWork(flow);
    events.publish("turns", { type: "flow", chainId: flow.chainId, id: flow.id, state: flow.state });
  };
  /** @param {Flow} flow */
  const save = (flow) => {
    store.put(flow.chainId, flow);
    said(flow);
    // A flow its main agent drives (OA4): what moved goes to it once this burst of changes is over.
    if (flow.drives && told.has(flow.id)) newsSoon(flow);
  };
  /** An act on a running flow, kept on it (OA4). @param {Flow} flow @param {By} who @param {string} what */
  const did = (flow, who, what) => noteAct(flow, { at: now(), by: who.by, what, ...(who.why ? { why: who.why } : {}) });
  /** A flow its main agent drives, still running or holding: every turn of its chat owes it (OA4). @param {Flow} f */
  const drivenLive = (f) => !!f.drives && (f.state === "running" || f.state === "holds");
  /** A chat's flows, none where they cannot be read. @param {string} chainId */
  const flowsOf = (chainId) => {
    try {
      return store.list(String(chainId || ""));
    } catch {
      return [];
    }
  };
  /** The turns of a chat that owed its driven flows let go, once none is driven. @param {string} chainId */
  const letGo = (chainId) => {
    const w = drivesOwed.get(chainId);
    if (!w || flowsOf(chainId).some(drivenLive)) return;
    drivesOwed.delete(chainId);
    w.done();
  };
  /** What moved in a flow its main agent drives goes to it once the burst that moved it is over: one word, not many. @param {Flow} flow */
  const newsSoon = (flow) => {
    if (newsDue.has(flow.id)) return;
    newsDue.add(flow.id);
    const { chainId, id } = flow;
    queueMicrotask(() => {
      newsDue.delete(id);
      tellDriver(chainId, id);
    });
  };
  /**
   * The main agent that drives a flow is told what moved since it was last told (OA4): into its running turn, which
   * wakes on it, else with the chat's next turn. Then the turns that owed the flow are let go, where it runs no more.
   * @param {string} chainId @param {string} id
   */
  function tellDriver(chainId, id) {
    if (closedDown) return;
    const flow = store.get(chainId, id);
    const mark = told.get(id);
    if (flow && mark) {
      const news = newsOf(mark, flow);
      told.set(id, newsMark(flow));
      if (news)
        try {
          registry().notice?.(chainId, { text: news.text, description: news.short });
        } catch (/** @type {any} */ e) {
          log("warn", `flows: ${id}'s news did not reach ${chainId}'s agent (${e?.message || e})`);
        }
      if (!drivenLive(flow) && flow.state !== "cut") told.delete(id);
    }
    letGo(chainId);
  }
  /**
   * What a driven flow's main agent is told after a restart (OA4 case 7): with the turn that goes on by itself, the
   * boxes the restart cut and the flow as it stands.
   * @param {Flow} flow @param {string[]} cut
   */
  function tellRestart(flow, cut) {
    told.set(flow.id, newsMark(flow));
    try {
      registry().notice?.(flow.chainId, { text: restartNotice(flow, roster(), cut), description: `the flow "${lineOf(flow.title, 60)}": Filament restarted${cut.length ? `, ${cut.length === 1 ? "1 box" : `${cut.length} boxes`} cut` : ""}` });
    } catch (/** @type {any} */ e) {
      log("warn", `flows: ${flow.id}'s restart was not told to ${flow.chainId}'s agent (${e?.message || e})`);
    }
  }
  /**
   * A chat's turn let go of it (the turn lock): where it drove a flow In place that has not ended (OA4), the flow follows
   * how the turn ended — Stop on the turn stops it (case 6); a turn that failed, or ended before the flow did, leaves it
   * holding for the person, who may go on beside the chat (case 8); a flow a restart cut waits for their Go on. A turn
   * that waits for the person's answer, or one another took up at once, drives it still.
   * @param {string} chainId
   */
  function driverLet(chainId) {
    if (closedDown || !chainId) return;
    const flows = flowsOf(chainId).filter((f) => f.drives && (drivenLive(f) || f.state === "cut"));
    if (!flows.length) return;
    /** @type {any} */
    let f = null;
    try {
      f = sessions.besideFacts(chainId);
    } catch {
      return;
    }
    if (!f || f.busy || f.asking) return;
    const last = f.last;
    for (const flow of flows) {
      if (last?.stopped) {
        halt(flow, PERSON, "stopped the turn that drove it, and the flow with it");
        continue;
      }
      const why = last?.failed ? `your agent's turn failed${last.why ? `: ${lineOf(last.why, 300)}` : ""}` : flow.state === "cut" ? "your agent's turn ended without going on with it after the restart" : "your agent's turn ended before the flow did";
      flow.drives = false;
      flow.lost = why;
      told.delete(flow.id);
      if (flow.state !== "cut") {
        flow.state = "holds";
        flow.hold = { kind: "driver", box: "" };
      }
      save(flow);
      alertOnce(`${flow.id}:driver:${flow.acts?.at(-1)?.n || 0}:${flow.state}`, `Your flow "${flow.title}" waits for you: ${why}`);
      log("info", `flows: ${flow.id} is driven no more (${why})`);
    }
    letGo(chainId);
  }
  /**
   * A flow stopped: every box at work stops, as a team or a sub-agent stops today, and a review that waited stops with
   * it; the flow says stopped. The act is kept.
   * @param {Flow} flow @param {By} who @param {string} what
   */
  function halt(flow, who, what) {
    flow.state = "stopped";
    flow.hold = null;
    flow.endedAt = now();
    for (const { box } of boxesOf(flow)) {
      if (box.kind === "review" && box.state === "asking") Object.assign(box, { state: "stopped", endedAt: now() });
      else if (live(box)) stopRun(box);
    }
    did(flow, who, what);
    save(flow);
  }
  /** @param {string} chainId */
  const chatOf = (chainId) => {
    const c = archive().getChain(String(chainId || ""));
    if (!c) throw refused(404, "no such session");
    return c;
  };
  /** @param {string} chainId @param {string} id @returns {Flow} */
  const flowIn = (chainId, id) => {
    chatOf(chainId);
    const f = store.get(chainId, id);
    if (!f) throw refused(404, "no flow of this chat answers to that id");
    return f;
  };
  /** @param {BoxRef} ref */
  const find = (ref) => {
    const flow = store.get(ref.chainId, ref.fid);
    const at = flow ? boxOf(flow, ref.bid) : null;
    return flow && at ? { flow, box: at.box, step: at.step } : null;
  };
  /** An alert once per thing it says. @param {string} key @param {string} text */
  const alertOnce = (key, text) => {
    if (alerted.has(key)) return;
    alerted.add(key);
    try {
      alert(text, `flow:${key}`);
    } catch {}
  };
  /** The `/flow` the person's newest message was, or null. @param {string} chainId @returns {FlowAsk | null} */
  const askOf = (chainId) => {
    const a = chatOf(chainId).meta?.flowAsk;
    return a && typeof a === "object" ? { goal: String(a.goal || ""), at: Number(a.at) || 0, drafted: a.drafted ? String(a.drafted) : null } : null;
  };
  /**
   * The person started or removed the flow their `/flow` was drafted as: that ask is answered, and no second flow is
   * drawn from it (the bug round of 10-23). An ask whose draft is another flow stays.
   * @param {string} chainId @param {string} id
   */
  const askAnswered = (chainId, id) => {
    if (askOf(chainId)?.drafted !== id) return;
    try {
      archive().mergeMeta(chainId, { flowAsk: undefined });
    } catch {}
  };

  /**
   * What an agent box is launched with: at its card's level, or reading only where drawn so (OA3, OA1-B8), its report
   * the flow's, waiting for a seat where none is free.
   * @param {Flow} flow @param {FlowBox} box @param {string} prompt
   */
  const launchSpec = (flow, box, prompt) => ({
    origin: /** @type {const} */ ("flow"),
    chainId: flow.chainId,
    as: box.agent,
    ...(box.readOnly ? { may: "read" } : {}),
    prompt,
    description: `${box.name}: ${lineOf(box.words, 60)}`,
    deliver: false,
    waits: true,
    ...(box.model ? { model: box.model } : {}),
    ...(box.effort ? { effort: /** @type {any} */ (box.effort) } : {}),
    ...(box.sees && box.sees !== "record" && box.sees !== "words" ? { view: box.sees } : {}),
    // Past the flow's first box that writes, in its worktree: it reads what the flow changed (OA5).
    ...(flow.place?.kind === "worktree" ? { cwd: flow.place.cwd } : {}),
  });

  /**
   * Why a box cannot work in its flow's worktree, in words — it is no longer there (OA5-B7) — else null: it fails then,
   * before any model is asked.
   * @param {Flow} flow
   */
  const goneWords = (flow) =>
    flow.place?.kind === "worktree" && !here(String(flow.place.cwd || "")) ? `its flow's worktree ${flow.place.folder || flow.place.cwd} is gone: put it back, or start the flow again` : null;

  /**
   * The sub-agent a box ran on is kept as it runs on another, or on none: its thread stays its flow's on the page.
   * @param {FlowBox} box @param {string | null} [next]  the one it runs on now
   */
  const keepRan = (box, next = null) => {
    const sub = box.run?.sub;
    if (!sub || sub === next) return;
    box.ran ||= [];
    if (!box.ran.includes(sub)) box.ran.push(sub);
  };

  /**
   * An agent box's launch (or follow-up) taken: the box runs on it, and its end comes back here.
   * @param {Flow} flow @param {FlowBox} box @param {{ ok: true, id: string, done: Promise<any> }} r
   */
  function runsOn(flow, box, r) {
    keepRan(box, r.id);
    box.run = { sub: r.id };
    const ref = { chainId: flow.chainId, fid: flow.id, bid: box.id };
    subs.set(r.id, ref);
    box.state = registry().get(r.id)?.waiting ? "seat" : "working";
    r.done.then(
      (o) => subEnded(ref, r.id, o),
      (e) => subEnded(ref, r.id, { ok: false, status: "failed", error: String(e?.message || e), report: "" }),
    );
  }

  /**
   * Start a box: its sub-agent launched, its team fired, or the person asked for their review. A launch that cannot
   * start fails the box in its words.
   * @param {Flow} flow @param {FlowBox} box @param {number} at  its step @param {string} [extra]  words after its ask
   */
  function startBox(flow, box, at, extra = "") {
    keepRan(box);
    Object.assign(box, { error: null, startedAt: now(), endedAt: null, result: null, verdict: null, run: null });
    delete (/** @type {any} */ (box).after);
    delete (/** @type {any} */ (box).stopping);
    delete box.place;
    delete box.failedOn;
    if (box.kind === "review") {
      box.state = "asking";
      alertOnce(`${flow.id}:review:${box.id}:${box.startedAt}`, `Your review in your flow "${flow.title}"`);
      return;
    }
    const a = boxAsk(flow, box, at);
    if (box.kind === "team") {
      box.state = "working";
      const ref = { chainId: flow.chainId, fid: flow.id, bid: box.id };
      // The flow's worktree (OA5): its first box that writes makes it from the main chat's folder; every box after works
      // there. One that writes while another's fire still makes it waits for that fire, so no second one is made.
      const ahead = placing.get(flow.id) || null;
      const makes = !flow.place && writes(box, roster());
      const run = Promise.resolve(ahead)
        .then(() => {
          const cur = find(ref);
          if (!cur) return null;
          // Skipped, stopped, or its flow stopped, while it waited for that fire: it never starts.
          if (cur.box.state !== "working") return null;
          if (cur.flow.state === "stopped" || /** @type {any} */ (cur.box).stopping) {
            boxEnds(cur.flow, cur.box, "stopped", "it was stopped before its lead started");
            return null;
          }
          const place = cur.flow.place;
          // The worktree it makes is given the folder's uncommitted files where the person asked (Bring my uncommitted edits).
          const own = { name: ownName(cur.flow), ...(cur.flow.bring ? { bring: true } : {}) };
          return besides().fire(flow.chainId, { team: box.agent, ask: a.ask, handoff: extra ? `${a.handoff}\n\n${extra}` : a.handoff, by: "flow", flow: { id: flow.id, box: box.id }, readOnly: box.readOnly, verify: false, notify: false, ...(box.model ? { model: box.model } : {}), ...(box.effort ? { effort: box.effort } : {}), ...(box.sees === "words" ? { reads: "words" } : {}), ...(place?.kind === "worktree" ? { own: { use: place } } : !place && writes(cur.box, roster()) ? { own } : {}) });
        })
        .then((row) => {
          if (!row) return;
          const now_ = find(ref);
          if (!now_ || now_.box.run) return;
          now_.box.run = { team: row.id };
          const place = row.place || now_.flow.place || null;
          if (row.place && !now_.flow.place) now_.flow.place = row.place;
          if (place && writes(now_.box, roster())) now_.box.place = place;
          teamChats.set(row.id, ref);
          save(now_.flow);
          // Stopped, or skipped, while its lead started — the flow, or the box itself: it stops at once.
          if (now_.flow.state === "stopped" || now_.box.state !== "working" || /** @type {any} */ (now_.box).stopping) {
            delete (/** @type {any} */ (now_.box).stopping);
            return stopRun(now_.box);
          }
          teamLook(row.id);
        })
        .catch((e) => {
          const now_ = find(ref);
          if (!now_) return;
          // The copy of the folder's uncommitted files failed, and the worktree went back with it: the box's card offers
          // Retry without them, which switches the flow's choice off while it still has no place.
          if (e?.bring === true && !now_.flow.place) now_.box.failedOn = "bring";
          boxEnds(now_.flow, now_.box, "failed", `it could not start: ${e?.message || e}`);
        });
      if (makes) {
        // The mark goes however the start ends — a box whose end itself threw must not keep the flow's Bring choice
        // from changing, nor the next writer from starting.
        /** @type {Promise<void>} */
        const made = run
          .catch((e) => log("warn", `flows: ${box.name} of the flow ${flow.id} did not end its start cleanly (${e?.message || e})`))
          .then(() => {
            if (placing.get(flow.id) === made) placing.delete(flow.id);
          });
        placing.set(flow.id, made);
      }
      return;
    }
    const gone = goneWords(flow);
    const r = gone ? { ok: /** @type {const} */ (false), error: gone } : registry().launch(launchSpec(flow, box, extra ? `${a.prompt}\n\n${extra}` : a.prompt));
    if (!r.ok) {
      box.state = "failed";
      box.error = `it could not start: ${r.error}`;
      box.endedAt = now();
      return;
    }
    runsOn(flow, box, r);
  }

  /**
   * A box ends otherwise than done: its words kept, its flow told.
   * @param {Flow} flow @param {FlowBox} box @param {"failed" | "stopped" | "cut" | "skipped"} state @param {string} why
   */
  function boxEnds(flow, box, state, why) {
    box.state = /** @type {any} */ (box).skipping ? "skipped" : state;
    delete (/** @type {any} */ (box).skipping);
    box.error = box.state === "skipped" ? null : why;
    box.endedAt = now();
    save(flow);
    advance(flow);
  }

  /**
   * An agent box's exchange ended: done with its report — a gate's verdict read off it — else failed or stopped.
   * @param {BoxRef} ref @param {string} subId @param {any} o  its outcome
   */
  function subEnded(ref, subId, o) {
    // Filament stops: the stop cut it, and the next start says so of its flow (`reconcile`), not as a stop of the person's.
    if (closedDown) return;
    subs.delete(subId);
    const at = find(ref);
    if (!at || at.box.run?.sub !== subId) return;
    const { flow, box } = at;
    box.usd = Math.round((box.usd + (Number(o?.spentUsd) || 0)) * 1e6) / 1e6;
    if (/** @type {any} */ (box).skipping) return boxEnds(flow, box, "skipped", "");
    if (o?.ok && o.status === "done") {
      box.state = "done";
      box.endedAt = now();
      // What it published and drew, as its thread keeps them — its exchange's, which its outcome does not carry
      // (HarnessV4_DesignPass_Plan, case 13: a box's artifacts never reached its flow before).
      const ex = registry().get?.(subId)?.exchanges?.at(-1) || null;
      const made = Array.isArray(ex?.made) ? ex.made : Array.isArray(o.made) ? o.made : [];
      const drew = Array.isArray(ex?.drew) ? ex.drew : Array.isArray(o.drew) ? o.drew : [];
      box.result = {
        text: String(o.report || ""),
        at: now(),
        made: made.map((/** @type {any} */ m) => ({ title: String(m.title || m.name || ""), address: String(m.address || "") })),
        ...(drew.length ? { drew: drew.map((/** @type {any} */ d) => ({ title: String(d.title || ""), bytes: Number(d.bytes) || 0 })) } : {}),
        ...(o.wrote ? { wrote: true } : {}),
      };
      if (box.gate) box.verdict = verdictOf(box.result.text);
      save(flow);
      return advance(flow);
    }
    if (o?.status === "stopped") return boxEnds(flow, box, "stopped", "it was stopped");
    if (o?.status === "aborted") return boxEnds(flow, box, "cut", "it was cut off before it reported");
    return boxEnds(flow, box, "failed", String(o?.error || `it ended ${o?.status || "without a report"}`));
  }

  /**
   * A team box's chat looked at: at work, asking the person, done with the reply its lead ended on (a reply that ends
   * on a question asks the person, FL-D18), or stopped. A box past its end does not change with its chat's later turns.
   * @param {string} teamId
   */
  function teamLook(teamId) {
    if (closedDown) return;
    const ref = teamChats.get(teamId);
    const at = ref ? find(ref) : null;
    if (!ref || !at || at.box.run?.team !== teamId) {
      teamChats.delete(teamId);
      return;
    }
    const { flow, box } = at;
    if (!live(box) && box.state !== "waits") return;
    const row = besides().row(teamId);
    if (!row) return;
    /** @type {any} */
    let f = null;
    try {
      f = sessions.besideFacts(teamId);
    } catch {}
    const key = `${flow.id}:${box.id}:${box.sentBack}`;
    // A line it owes its chat, refused while its lead's question waited (`lineTo`), goes once the chat lets go of the
    // answer's turn: the reply that turn ended on answers the person, not the flow.
    const owed = /** @type {any} */ (box).owed;
    if (owed && row.state !== "working" && row.state !== "asking") {
      delete (/** @type {any} */ (box).owed);
      /** @type {any} */ (box).after = turnOf(teamId);
      Object.assign(box, { state: "working", error: null });
      save(flow);
      return lineTo(ref, teamId, owed.text, owed.fails || "it could not go on");
    }
    // Sent back or gone on with: what its chat ended on before is no answer to that — its next turn is.
    if (row.state !== "working" && row.state !== "asking" && (Number(f?.last?.n) || 0) <= (Number(/** @type {any} */ (box).after) || 0)) return;
    if (row.state === "working") {
      if (box.state === "working") return;
      box.state = "working";
      box.error = null;
      return save(flow);
    }
    if (row.state === "asking") {
      if (box.state === "asking") return;
      box.state = "asking";
      box.error = "its lead asks you a question: open its chat to answer";
      save(flow);
      return alertOnce(`${key}:ask`, `${box.name} asks you, in your flow "${flow.title}"`);
    }
    const text = String(f?.last?.text || "");
    if (row.state === "done") {
      box.usd = usdOf(teamId, box.usd);
      if (endsAsking(text) && !(/** @type {any} */ (box).handOn)) {
        if (box.state === "asking" && box.result?.n === f?.last?.n) return;
        box.state = "asking";
        box.error = "its lead's reply ends on a question: answer it in its chat, or hand the reply on anyway";
        box.result = { text, n: Number(f?.last?.n) || 0, at: now() };
        save(flow);
        return alertOnce(`${key}:q${f?.last?.n}`, `${box.name} ends on a question, in your flow "${flow.title}"`);
      }
      delete (/** @type {any} */ (box).handOn);
      box.state = "done";
      box.error = null;
      box.endedAt = now();
      const drew = Array.isArray(f?.last?.drew) ? f.last.drew : [];
      box.result = { text, n: Number(f?.last?.n) || 0, at: now(), ...(drew.length ? { drew: drew.map((/** @type {any} */ d) => ({ title: String(d.title || ""), bytes: Number(d.bytes) || 0 })) } : {}) };
      teamChats.delete(teamId);
      save(flow);
      return advance(flow);
    }
    teamChats.delete(teamId);
    box.usd = usdOf(teamId, box.usd);
    if (f?.last?.cut) return boxEnds(flow, box, "cut", "a restart cut its lead's turn off");
    if (f?.last?.failed) return boxEnds(flow, box, "failed", "its lead's turn failed: open its chat to see why");
    return boxEnds(flow, box, "stopped", "its lead's turn stopped before a reply");
  }
  /** A team chat's newest turn's number, 0 where it has none. @param {string} teamId */
  const turnOf = (teamId) => {
    try {
      return Number(sessions.besideFacts(teamId)?.last?.n) || 0;
    } catch {
      return 0;
    }
  };
  /** What a team chat has spent, else what was known. @param {string} teamId @param {number} had */
  const usdOf = (teamId, had) => {
    try {
      return Math.round((Number(sessions.leadFacts?.(teamId)?.usd) || had) * 1e6) / 1e6;
    } catch {
      return had;
    }
  };

  /**
   * Hold the flow for the person: a gate that did not say go, or a box that failed or was stopped.
   * @param {Flow} flow @param {{ kind: "gate" | "box", box: string }} hold @param {string} text
   */
  function holdFor(flow, hold, text) {
    flow.state = "holds";
    flow.hold = hold;
    save(flow);
    const b = boxOf(flow, hold.box)?.box;
    alertOnce(`${flow.id}:${hold.kind}:${hold.box}:${b?.sentBack ?? 0}:${b?.endedAt ?? 0}`, text);
  }

  /**
   * The flow goes as far as it can: the step it is at starts its boxes that wait, once the step before it let it pass;
   * a gate that did not say go, or a box that failed or stopped, holds it; past its last step it ends.
   * @param {Flow} flow
   */
  function advance(flow) {
    if (flow.state !== "running" || closedDown) return;
    const at = stepAt(flow);
    if (at < 0) return finish(flow);
    const step = flow.steps[at];
    if (step.boxes.some(live)) return;
    const down = step.boxes.find((b) => b.state === "failed" || b.state === "stopped" || b.state === "cut");
    if (down) return holdFor(flow, { kind: "box", box: down.id }, `${down.name} ${down.state === "failed" ? "failed" : "stopped"} in your flow "${flow.title}": ${flow.drives ? "your agent retries or skips it, or you do" : "Retry, Skip or Stop"}`);
    const gate = step.boxes.find((b) => b.gate && b.state === "done" && !passed(b));
    if (gate) return holdFor(flow, { kind: "gate", box: gate.id }, `${gate.name} says ${gate.verdict ? "not yet" : "no verdict"} in your flow "${flow.title}": ${flow.drives ? "your agent decides, or you do" : "it asks you"}`);
    for (const box of step.boxes) if (box.state === "waits") startBox(flow, box, at);
    save(flow);
    // A box that could not start holds the flow at once.
    if (step.boxes.some((b) => b.state === "failed")) advance(flow);
  }

  /** The flow's end: done; its message to the main agent where the person left that on. @param {Flow} flow */
  function finish(flow) {
    flow.state = "done";
    flow.hold = null;
    flow.endedAt = now();
    // Driven In place (OA4), its main agent hears its end in the turn that drives it: no message of its own follows.
    const pictures = (/** @type {{ title: string, bytes: number }[]} */ drew) => String(registry().drewWords?.(flow.chainId, drew, "Its boxes") || "");
    flow.end = flow.tell && !flow.drives ? { text: endMessage(flow, roster(), registry().drewWords ? pictures : null), sent: null, missed: null } : null;
    save(flow);
    alertOnce(`${flow.id}:done`, `Your flow "${flow.title}" is done`);
    if (flow.end) void sendEnd(flow);
  }

  /**
   * The end message to the main agent, as a team's result goes — sealed while its agent works (HarnessV4_Envelopes_Plan
   * EN4); its flow keeps where it went. @param {Flow} flow
   */
  async function sendEnd(flow) {
    if (!flow.end || flow.end.sent) return;
    const ref = { chainId: flow.chainId, fid: flow.id };
    /** @param {(f: Flow) => void} fn */
    const mark = (fn) => {
      const f = store.get(ref.chainId, ref.fid);
      if (f?.end) {
        fn(f);
        save(f);
      }
    };
    endWaits.add(flow.id);
    try {
      const how = await besides().deliverOwn(flow.chainId, {
        id: flow.id,
        text: flow.end.text,
        envelope: endEnvelope(flow),
        sent: (/** @type {string | null} */ how, /** @type {string | undefined} */ why) => {
          endWaits.delete(ref.fid);
          mark((f) => {
            if (f.end && how) f.end.sent = { at: now(), how };
            else if (f.end) f.end.missed = why || "it was refused";
          });
        },
      });
      if (how !== "waits") {
        endWaits.delete(flow.id);
        mark((f) => {
          if (f.end) f.end.sent = { at: now(), how };
        });
      } else said(flow);
    } catch (/** @type {any} */ e) {
      endWaits.delete(flow.id);
      log("warn", `flows: ${flow.id}'s end did not reach ${flow.chainId} (${e?.message || e})`);
      mark((f) => {
        if (f.end) f.end.missed = String(e?.message || e);
      });
    }
  }

  /**
   * A box sent back from a gate or the person's review (§4.5): a follow-up in its own exchange while the registry holds
   * it, else a fresh start with its ask and what sent it back; a team box, a new turn in its chat — its changes stay.
   * @param {Flow} flow @param {FlowBox} box @param {number} at @param {{ gate: string, review?: boolean, answer: string, line: string, by?: "person" | "agent" }} o
   */
  function sendBack(flow, box, at, o) {
    const text = backAsk(box, o);
    Object.assign(box, { error: null, startedAt: now(), endedAt: null, state: "working" });
    delete (/** @type {any} */ (box).handOn);
    if (box.kind === "team") {
      const id = box.run?.team;
      if (!id) return startBox(flow, box, at, text);
      const ref = { chainId: flow.chainId, fid: flow.id, bid: box.id };
      /** @type {any} */ (box).after = turnOf(id);
      teamChats.set(id, ref);
      lineTo(ref, id, text, "it could not be sent back");
      return;
    }
    const sub = box.run?.sub;
    let r = sub ? registry().followUp(sub, { prompt: text, chainId: flow.chainId, by: "flow", deliver: false, description: `${box.name}: sent back` }) : { ok: false, error: "" };
    // Let go, or with no seat for its follow-up: a fresh start, which waits for one.
    if (!r.ok) r = registry().launch(launchSpec(flow, box, `${boxAsk(flow, box, at).prompt}\n\n${text}`));
    if (!r.ok) {
      box.state = "failed";
      box.error = `it could not be sent back: ${r.error}`;
      box.endedAt = now();
      return;
    }
    runsOn(flow, box, r);
  }

  /**
   * A box that stopped, failed or was cut goes again: an agent box starts afresh; a team box's chat goes on with the
   * flow's line to go on — the person's press, which its chat draws as the flow's. A turn a restart cut kept its work
   * (cut-turns.js), so the lead goes on from where it was cut; Filament's own resume would say it went on by itself.
   * @param {Flow} flow @param {FlowBox} box @param {number} at
   */
  function again(flow, box, at) {
    const id = box.kind === "team" ? box.run?.team : null;
    if (!id) return startBox(flow, box, at);
    // Its chat works in the flow's worktree: one no longer there fails it in words, before its lead is asked (OA5-B7).
    const gone = goneWords(flow);
    if (gone) {
      Object.assign(box, { state: "failed", error: `it could not go on: ${gone}`, endedAt: now() });
      return;
    }
    const ref = { chainId: flow.chainId, fid: flow.id, bid: box.id };
    Object.assign(box, { error: null, endedAt: null, state: "working" });
    delete (/** @type {any} */ (box).handOn);
    /** @type {any} */ (box).after = turnOf(id);
    teamChats.set(id, ref);
    // A line it still owed its chat — what sent it back, cut by a restart while a question waited — goes in place of the
    // line to go on: it says what to do again.
    const owed = /** @type {any} */ (box).owed;
    delete (/** @type {any} */ (box).owed);
    lineTo(ref, id, owed?.text || GO_ON_LINE, "it could not go on");
  }

  /**
   * Filament's own turn into a team box's chat — what sent it back, or its line to go on. It goes past a switch's card
   * nobody is there to answer (the review of fd62160df: a team chat whose model changed failed the box), as a wake does —
   * never as the person's Send as it is (the owner's of 11-09). A chat whose lead's question waits for the person refuses
   * it, which would answer that question (`byFilament: "asking"`, the review of 54f63529f): the box waits with its
   * chat, its line kept (`owed`), and the line goes once the chat lets go of the answer's turn (`teamLook`) — as a
   * team's result waits out the main chat's question (teams-beside.js). So does a chat a turn holds (its refusal names
   * the `holder`, as teams beside read it) — the person's, typed in it meanwhile, or its agent's own: the box stays at
   * work, and the line goes once that turn ends, never into it (the hunt of 11-09: the box failed, its line lost). Any
   * other refusal fails the box, in its words.
   * @param {{ chainId: string, fid: string, bid: string }} ref @param {string} id  the team chat @param {string} text
   * @param {string} fails  what a refusal fails the box with, ahead of its words
   */
  function lineTo(ref, id, text, fails) {
    void postTurn(id, { content: [{ type: "text", text }], by: "flow" })
      .then((r) => {
        if (r.status >= 200 && r.status < 300) return teamLook(id);
        const now_ = find(ref);
        if (!now_) return;
        if (r.status === 409 && r.body?.byFilament === "asking") {
          const { flow, box } = now_;
          /** @type {any} */ (box).owed = { text, fails };
          box.state = "asking";
          box.error = "its lead asks you a question: open its chat to answer — what the flow sent it goes once you have";
          save(flow);
          return alertOnce(`${flow.id}:${box.id}:${box.sentBack}:ask`, `${box.name} asks you, in your flow "${flow.title}"`);
        }
        if (r.status === 409 && r.body?.holder) {
          /** @type {any} */ (now_.box).owed = { text, fails };
          save(now_.flow);
          // Looked at once now: a turn that ended while the refusal came back said so before the line was kept.
          return teamLook(id);
        }
        boxEnds(now_.flow, now_.box, "failed", `${fails}: ${String(r.body?.error || `HTTP ${r.status}`)}`);
      })
      .catch((e) => {
        const now_ = find(ref);
        if (now_) boxEnds(now_.flow, now_.box, "failed", `${fails}: ${e?.message || e}`);
      });
  }

  /**
   * A team box Filament stopped while its lead started (`reconcile`): the chat its fire made, found by its flow and box,
   * is its run again — Go on goes on in it — and the worktree that fire made is the flow's, so no second one is made.
   * A chat with no turn yet gives only its place: the box starts afresh there.
   * @param {Flow} flow @param {FlowBox} box
   */
  function adopt(flow, box) {
    try {
      const a = archive();
      for (const id of a.besideOf?.(flow.chainId) || []) {
        const b = a.getChain(id)?.meta?.beside;
        if (!b || b.flow?.id !== flow.id || b.flow?.box !== box.id) continue;
        const place = b.place && typeof b.place === "object" ? b.place : null;
        if (place && !flow.place) flow.place = place;
        if (place && writes(box, roster())) box.place = place;
        if (turnOf(id) > 0) box.run = { team: id };
        log("info", `flows: ${box.name} of the flow ${flow.id}, cut while its lead started, has its chat ${id} again${place?.kind === "worktree" ? ` and the worktree ${place.folder}` : ""}`);
        return;
      }
    } catch (/** @type {any} */ e) {
      log("warn", `flows: the chat of ${box.name}, cut while its lead started, was not found again (${e?.message || e})`);
    }
  }

  /** Stop a box's run, where one runs. @param {FlowBox} box */
  function stopRun(box) {
    try {
      if (box.run?.sub) registry().stop(box.run.sub);
      else if (box.run?.team) besides().stop(box.run.team);
    } catch (/** @type {any} */ e) {
      log("warn", `flows: a box's run could not be stopped (${e?.message || e})`);
    }
  }

  /**
   * A flow as the page reads it: its line, its problem while drawn, the seats it takes, each box's state in words,
   * whether it writes, what it needs — those that do not hold said (OA3 case 5) — what it waits for, its result cut
   * for the card.
   * @param {Flow} flow
   */
  function view(flow) {
    const r = roster();
    let teamChat = false;
    try {
      teamChat = archive().getChain(flow.chainId)?.kind === "team";
    } catch {}
    const usd = boxesOf(flow).reduce((n, x) => n + (x.box.run?.team && live(x.box) ? usdOf(x.box.run.team, x.box.usd) : x.box.usd), 0);
    const broken = brokenNeeds(flow);
    return {
      ...flow,
      line: flowLine(flow),
      at: stepAt(flow),
      problem: flow.state === "draft" ? checkFlow(flow, r, { teamChat }) : null,
      seats: seatsOf(flow),
      usd: Math.round(usd * 1e6) / 1e6,
      end: flow.end ? { ...flow.end, text: flow.end.text.slice(0, CARD_RESULT), waits: endWaits.has(flow.id), lost: !flow.end.sent && !flow.end.missed && !endWaits.has(flow.id) } : null,
      steps: flow.steps.map((s) => ({
        why: s.why,
        boxes: s.boxes.map((b) => {
          const sub = b.run?.sub ? registry().get(b.run.sub) : null;
          const text = String(b.result?.text || "");
          return {
            ...b,
            words_: BOX_WORDS[b.state],
            writes: writes(b, r),
            needsOf: b.needs.map((n) => ({ id: n, name: boxOf(flow, n)?.box.name || n })),
            broken: broken.get(b.id) || [],
            waiting: b.state === "seat" ? String(sub?.waiting?.words || "a free seat") : null,
            usd: b.run?.team && live(b) ? usdOf(b.run.team, b.usd) : b.usd,
            result: b.result ? { ...b.result, text: text.slice(0, CARD_RESULT), more: text.length > CARD_RESULT, chars: text.length } : null,
            past: b.past.map((p) => ({ ...p, text: p.text.slice(0, CARD_RESULT) })),
          };
        }),
      })),
    };
  }

  /** @param {string} chainId */
  const teamChatOf = (chainId) => chatOf(chainId).kind === "team";
  /**
   * Why a draft the person draws or changes is refused while Settings › Experimental's Teams switch is off: its first
   * team box, in words; null while teams are on, or with none. A draft's boxes have not started.
   * @param {Pick<Flow, "steps">} flow
   */
  const teamDrawnOff = (flow) => {
    const team = teamsOn() ? null : boxesOf(flow).find((x) => x.box.kind === "team");
    return team ? `${team.box.name || "a box"} (step ${team.step + 1}) is a team, and ${TEAMS_OFF_WHY}: draw the flow with the person's agents, or turn teams on` : null;
  };

  /**
   * The person's review decided (OA-D10): `on` — they go on, their line its result; `back` — a box it needs goes again
   * with their line, then they review again; `stop` — the flow stops.
   * @param {Flow} flow @param {{ box: FlowBox, step: number }} at @param {{ action?: unknown, to?: unknown, line?: unknown }} input
   */
  function review(flow, at, input) {
    const box = at.box;
    if (flow.state !== "running" || box.state !== "asking") throw refused(409, "your review does not wait now");
    if (input.action === "stop") return api.stop(flow.chainId, flow.id);
    const line = clean(input.line);
    if (line.length > FLOW_LIMITS.line) throw refused(400, `your line is ${FLOW_LIMITS.line} characters at most; this is ${line.length}`);
    if (input.action === "on") {
      Object.assign(box, { state: "done", error: null, endedAt: now(), result: { text: reviewResult(line), at: now() } });
      did(flow, { by: "person", why: line }, "went on past their review");
      save(flow);
      advance(flow);
      return view(flow);
    }
    if (input.action !== "back") throw refused(400, "action is on, back (with to: a box your review needs) or stop");
    const target = boxOf(flow, String(input.to ?? ""));
    if (!target || !box.needs.includes(target.box.id)) throw refused(400, "send it back to a box your review needs");
    if (target.box.kind === "review") throw refused(400, NO_REVIEW_BACK);
    Object.assign(box, { state: "waits", error: null, startedAt: null, endedAt: null });
    box.sends = (box.sends || 0) + 1;
    target.box.sentBack += 1;
    flow.sentBack += 1;
    sendBack(flow, target.box, target.step, { gate: REVIEW_NAME, review: true, answer: "", line });
    did(flow, { by: "person", why: line }, `sent ${target.box.name} back from their review`);
    save(flow);
    if (target.box.state === "failed") advance(flow);
    return view(flow);
  }

  // A team box's chat changed (teams beside say each change), and a box's sub-agent moved (it may have its seat now).
  const offs = [
    events.subscribe?.("turns", (msg) => {
      if (msg?.type === "beside" && teamChats.has(String(msg.id))) {
        try {
          teamLook(String(msg.id));
        } catch (/** @type {any} */ e) {
          log("warn", `flows: a team box could not be looked at (${e?.message || e})`);
        }
      }
      // A chat's turn let go of it: the flow it drove In place follows how it ended (OA4).
      if (msg?.type === "turn" && !msg.holder) {
        try {
          driverLet(String(msg.chainId || ""));
        } catch (/** @type {any} */ e) {
          log("warn", `flows: the end of a turn that drove a flow could not be settled (${e?.message || e})`);
        }
      }
    }),
    events.subscribe?.("subagents", (msg) => {
      const id = String(msg?.id || "");
      const ref = id ? subs.get(id) : null;
      const at = ref ? find(ref) : null;
      if (!at || at.box.state !== "seat" || registry().get(id)?.waiting) return;
      at.box.state = "working";
      save(at.flow);
    }),
  ];

  const api = {
    /**
     * The flows at work now, every chat's: running or holding, each with its line and whether it asks the person —
     * what keeps a chat under Now's Working once its turn is over (the owner's of 10-28).
     * @returns {FlowAtWork[]}
     */
    live() {
      if (!atWork) {
        atWork = new Map();
        let chats = /** @type {string[]} */ ([]);
        try {
          chats = [...store.chats()];
        } catch {}
        for (const chainId of chats) for (const flow of flowsOf(chainId)) keepAtWork(flow);
      }
      return [...atWork.values()];
    },
    /**
     * A chat's flows, the newest first, as the page reads them.
     * @param {string} chainId
     */
    list(chainId) {
      chatOf(chainId);
      return [...store.list(chainId)].reverse().map(view);
    },
    /** @param {string} chainId @param {string} id */
    get: (chainId, id) => view(flowIn(chainId, id)),
    /**
     * How many uncommitted files a draft's worktree would leave in the chat's folder (OA5): its first team box that
     * writes starts a branch from the folder's last commit, so they stay there unless the person brings them.
     * `uncommitted` null where there is nothing to say — no draft of the chat has a team box that writes, so git is not
     * asked, or no worktree would be made; with `error`, why git could not tell, which the card says so the person may
     * ask again, or start knowing it is not known.
     * @param {string} chainId @returns {Promise<{ uncommitted: number | null, error?: string }>}
     */
    async leftBehind(chainId) {
      const r = roster();
      if (!uncommittedOf || !flowsOf(chainId).some((f) => f.state === "draft" && boxesOf(f).some((x) => writes(x.box, r)))) return { uncommitted: null };
      try {
        const left = await uncommittedOf(chainId);
        return left.ok ? { uncommitted: left.count } : { uncommitted: null, error: left.error };
      } catch (/** @type {any} */ e) {
        return { uncommitted: null, error: String(e?.message || e) };
      }
    },
    /**
     * A box's result whole (Open on its card), and its earlier answers where it is a gate.
     * @param {string} chainId @param {string} id @param {string} bid
     */
    result(chainId, id, bid) {
      const at = boxOf(flowIn(chainId, id), bid);
      if (!at) throw refused(404, "no box of this flow answers to that id");
      return { id: at.box.id, name: at.box.name, state: at.box.state, result: at.box.result, past: at.box.past, verdict: at.box.verdict, run: at.box.run };
    },
    /**
     * The person's agents and teams a flow's box may be, as the line ahead of a /flow message names them: no team while
     * teams are off. @returns {Roster}
     */
    roster: () => (teamsOn() ? roster() : { ...roster(), teams: [] }),
    /**
     * Whether the person's newest message asks the main agent for a flow (`/flow`, OA-D6): its words are the flow's, and
     * the main agent may draft one until their next message. The sessions service says it at each message of theirs.
     * @param {string} chainId @param {string | null} words  their `/flow` words, or null for a message of another kind
     */
    asked(chainId, words) {
      const a = archive();
      if (!a.getChain(String(chainId || ""))) return;
      a.mergeMeta(chainId, { flowAsk: words == null ? undefined : { goal: clean(words).slice(0, FLOW_LIMITS.goal), at: now(), drafted: null } });
    },
    /**
     * A flow drawn by hand (Agents › Flows) or from a saved one: a draft the person reads, edits and starts. Refused in
     * a team's own chat.
     * @param {string} chainId @param {any} input @param {{ drawn?: Flow["drawn"] }} [o]
     */
    create(chainId, input, { drawn = "hand" } = {}) {
      if (teamChatOf(chainId)) throw refused(400, "a team's own chat draws no flow: draw it in its main chat");
      const flow = flowOf(input, roster(), { id: newId(), chainId, at: now(), drawn });
      if (!flow.goal) throw refused(400, "say what the flow is for: its words head every box's ask");
      const off = teamDrawnOff(flow);
      if (off) throw refused(400, off);
      save(flow);
      return view(flow);
    },
    /**
     * The main agent's draft (OA3, L17, L22, L37): only while the person's newest message is `/flow`, its words the
     * flow's; checked whole — a stranger, a need out of order, two writers in a step are refused in words, and nothing
     * is kept. A second draft in the same ask replaces the first while it stands.
     * @param {string} chainId @param {any} input  `{ title?, steps }`
     * @returns {Flow}
     */
    draftBy(chainId, input) {
      if (teamChatOf(chainId)) throw refused(400, "a team's own chat draws no flow: its main chat does");
      const ask = askOf(chainId);
      if (!ask) throw refused(409, "a flow is drawn only when the person asks for one with /flow, or presses Run as a flow: do the work as you would — where their message lays out steps in order, offer the button (action offer)");
      const r = roster();
      const prior = ask.drafted ? store.get(chainId, ask.drafted) : null;
      const keep = prior && prior.state === "draft" ? prior : null;
      const flow = flowOf({ title: input?.title, goal: ask.goal, steps: input?.steps, tell: keep ? keep.tell : true, bring: keep?.bring === true }, r, { id: keep?.id || newId(), chainId, at: keep?.at || now(), drawn: "agent" });
      // A second draft in the same ask keeps what the person picked on the first's boxes it names again.
      if (keep) keepPicks(flow.steps, input?.steps, keep);
      const problem = checkFlow(flow, r, { teams: teamsOn() });
      if (problem) throw refused(400, problem);
      save(flow);
      archive().mergeMeta(chainId, { flowAsk: { ...ask, drafted: flow.id } });
      log("info", `flows: ${flow.id} drafted by the main agent of ${chainId}: ${flow.steps.length} steps, ${boxesOf(flow).length} boxes`);
      return flow;
    },
    /**
     * The main agent changes a draft it drew while it stands (OA3 case 6): its steps whole, or its title. Checked whole
     * as a draft is; a refusal leaves the draft as it was.
     * @param {string} chainId @param {any} input  `{ flow?, title?, steps? }`
     * @returns {Flow}
     */
    editBy(chainId, input) {
      chatOf(chainId);
      const want = input?.flow == null ? "" : String(input.flow);
      const mine = [...store.list(chainId)].reverse().filter((f) => f.drawn === "agent" && f.state === "draft");
      const flow = want ? mine.find((f) => f.id === want) : mine[0];
      if (!flow) {
        // A flow it drives In place (OA4 case 3): the steps to come, as the person's edit of a running flow changes them.
        const driven = [...store.list(chainId)].reverse().filter(drivenLive);
        const d = want ? driven.find((f) => f.id === want) : driven[0];
        if (d) {
          if (!Array.isArray(input?.steps)) throw refused(400, "a flow you drive changes by its steps: send them whole — those up to the one at work stay as they are");
          api.edit(chainId, d.id, { steps: input.steps }, { by: "agent", why: clean(input?.why) });
          told.set(d.id, newsMark(d));
          return d;
        }
        throw refused(409, want ? `no draft of yours answers to ${want}: one the person started or discarded is theirs now` : "no draft of yours stands in this chat: one the person started or discarded is theirs now, and /flow asks you for a new one");
      }
      const r = roster();
      const next = flowOf({ title: input?.title ?? flow.title, goal: flow.goal, steps: Array.isArray(input?.steps) ? input.steps : stepsInput(flow), tell: flow.tell }, r, { id: flow.id, chainId, at: flow.at, drawn: "agent" });
      if (Array.isArray(input?.steps)) keepPicks(next.steps, input.steps, flow);
      const problem = checkFlow(next, r, { teams: teamsOn() });
      if (problem) throw refused(400, problem);
      Object.assign(flow, { steps: next.steps, title: next.title });
      save(flow);
      return flow;
    },
    /**
     * The chat's flows in words, the newest first, as the main agent's flow tool reads them: whether it may draft now,
     * each flow, and the person's agents and teams.
     * @param {string} chainId
     */
    read(chainId) {
      const ask = askOf(chainId);
      const flows = [...store.list(chainId)].reverse().slice(0, READ_FLOWS);
      const r = roster();
      return [
        ask ? "The person's newest message is /flow: you may draft its flow (action draft)." : "The person's newest message is no /flow: you may not draft a flow now, only change a draft of yours that stands (action edit).",
        "",
        flows.length
          ? flows.map((f) => `${flowText(f, r)}${f.drawn === "agent" && f.state === "draft" ? "\n(a draft of yours: you may change it until the person starts it)" : ""}${f.drives && (drivenLive(f) || f.state === "cut") ? '\n(you drive it in place: actions "box", "edit" and "stop" act on it)' : ""}`).join("\n\n")
          : "No flow stands in this chat.",
        "",
        rosterWords(teamsOn() ? r : { ...r, teams: [] }, { teams: teamsOn() }),
      ].join("\n");
    },
    /**
     * A drawn flow changed: whole while it is drawn; while it runs, the steps after the one it is at (case 18), and
     * Tell my agent at any time before its end; Bring my uncommitted edits until its worktree is made — so after its
     * first writer failed to make one (the copy of the edits failed), Retry without them.
     * @param {string} chainId @param {string} id @param {any} input @param {By} [who]  the person, or the main agent that drives it
     */
    edit(chainId, id, input, who = PERSON) {
      const flow = flowIn(chainId, id);
      if (flow.state === "done" || flow.state === "stopped") throw refused(409, "the flow has ended: draw another");
      if (typeof input?.bring === "boolean" && input.bring !== !!flow.bring) {
        if (flow.place) throw refused(409, "its worktree is made already: what it was given of your folder stays as it was");
        if (placing.has(flow.id)) throw refused(409, "its worktree is being made now: what it is given of your folder is settled");
      }
      if (typeof input?.tell === "boolean") flow.tell = input.tell;
      if (typeof input?.bring === "boolean") {
        if (input.bring) flow.bring = true;
        else delete flow.bring;
      }
      if (Array.isArray(input?.steps)) {
        if (flow.state === "draft") {
          const next = flowOf({ ...input, goal: input.goal ?? flow.goal, title: input.title ?? flow.title }, roster(), { id: flow.id, chainId, at: flow.at, drawn: flow.drawn });
          const off = teamDrawnOff(next);
          if (off) throw refused(400, off);
          Object.assign(flow, { steps: next.steps, goal: next.goal, title: next.title });
        } else {
          const from = Math.max(0, stepAt(flow)) + 1;
          const kept = flow.steps.slice(0, from);
          // The steps whole, as the tool and the page send them: those that started first, each with its boxes. A list of
          // the steps to come alone would be read as no step to come at all (the hunt of 10-23).
          const whole = input.steps.length >= from && kept.every((st, i) => st.boxes.every((b) => (Array.isArray(input.steps[i]?.boxes) ? input.steps[i].boxes : []).some((/** @type {any} */ x) => x?.id === b.id)));
          if (!whole)
            throw refused(400, `send the steps whole: the ${from === 1 ? "step that started, as it stands" : `${from} steps that started, as they stand`} (${kept.map((st) => st.boxes.map((b) => b.id).join(", ")).join("; ")}), then the steps to come`);
          const before = (kept.at(-1)?.boxes || []).map((b) => b.id);
          const next = flowOf({ goal: flow.goal, steps: input.steps.slice(from) }, roster(), { id: flow.id, chainId, at: flow.at, taken: new Set(boxesOf({ steps: kept }).map((x) => x.box.id)), before }).steps;
          if (who.by === "agent") keepPicks(next, input.steps.slice(from), flow);
          const steps = [...kept, ...next];
          const problem = checkFlow({ ...flow, steps }, roster(), { teams: teamsOn() });
          if (problem) throw refused(400, problem);
          flow.steps = steps;
          did(flow, who, "changed the steps to come");
        }
      } else if (flow.state === "draft" && (typeof input?.goal === "string" || typeof input?.title === "string")) {
        if (typeof input.goal === "string") flow.goal = clean(input.goal);
        if (typeof input.title === "string") flow.title = lineOf(input.title, FLOW_LIMITS.title) || flow.title;
      }
      save(flow);
      return view(flow);
    },
    /**
     * Start a drawn flow beside its chat (FL-D2): its first step's boxes start, and its main agent is told the flow as
     * it stands — with its next message, or into its running turn (OA-D8). Refused in words where the draft does not
     * hold.
     * @param {string} chainId @param {string} id
     */
    start(chainId, id) {
      const flow = flowIn(chainId, id);
      if (flow.state !== "draft") throw refused(409, "the flow has started already");
      const problem = checkFlow(flow, roster(), { teamChat: teamChatOf(chainId), teams: teamsOn() });
      if (problem) throw refused(400, problem);
      flow.state = "running";
      flow.startedAt = now();
      save(flow);
      askAnswered(chainId, flow.id);
      log("info", `flows: ${flow.id} started beside ${chainId}: ${flow.steps.length} steps, ${boxesOf(flow).length} boxes`);
      try {
        registry().notice?.(chainId, { text: startNotice(flow, roster()), description: `the flow "${lineOf(flow.title, 60)}"` });
      } catch (/** @type {any} */ e) {
        log("warn", `flows: ${flow.id}'s start was not told to ${chainId}'s agent (${e?.message || e})`);
      }
      advance(flow);
      return view(flow);
    },
    /**
     * Start a drawn flow In place (OA4 case 1): a turn of the main agent opens to drive it — its message Filament's, the
     * flow as it stands and what the agent may do to it — and the first step's boxes start. Refused while a turn of the
     * chat runs or a question waits for the person; a turn that does not start leaves the draft as it was.
     * @param {string} chainId @param {string} id
     */
    async startInPlace(chainId, id) {
      const flow = flowIn(chainId, id);
      if (flow.state !== "draft") throw refused(409, "the flow has started already");
      const problem = checkFlow(flow, roster(), { teamChat: teamChatOf(chainId), teams: teamsOn() });
      if (problem) throw refused(400, problem);
      /** @type {any} */
      let f = null;
      try {
        f = sessions.besideFacts(chainId);
      } catch {}
      if (f?.busy) throw refused(409, "a turn runs in your chat: start the flow in place once it ends, or beside your chat now");
      if (f?.asking) throw refused(409, "a question waits for your answer in your chat: answer it first, or start the flow beside your chat");
      Object.assign(flow, { state: "running", startedAt: now(), inPlace: true, drives: true, lost: null });
      told.set(flow.id, newsMark(flow));
      save(flow);
      /** @type {{ status: number, body: any }} */
      let r;
      try {
        r = await postTurn(chainId, { content: [{ type: "text", text: driveNotice(flow, roster()) }], by: "beside" });
      } catch (/** @type {any} */ e) {
        r = { status: 500, body: { error: String(e?.message || e) } };
      }
      if (r.status < 200 || r.status >= 300) {
        Object.assign(flow, { state: "draft", startedAt: null, inPlace: false, drives: false });
        told.delete(flow.id);
        save(flow);
        letGo(chainId);
        throw refused(409, `your agent's turn did not start, so the flow did not: ${String(r.body?.error || `HTTP ${r.status}`)}`);
      }
      askAnswered(chainId, flow.id);
      log("info", `flows: ${flow.id} started in place in ${chainId}: ${flow.steps.length} steps, ${boxesOf(flow).length} boxes`);
      advance(flow);
      return view(flow);
    },
    /**
     * The main agent acts on a flow it drives In place (OA4 cases 3, 4): `box` with `do` — stop, skip or retry a box; at
     * a gate the flow waits at, go on past it or send a box it needs back, each with why — or `stop` the flow. The
     * person's review is theirs alone (case 5). Each act is kept on the flow, which the person reads; what came of it is
     * the agent's next word, not this act's own. Refused in words otherwise.
     * @param {string} chainId @param {any} input  `{ action: "box" | "stop", flow?, box?, do?, to?, why? }`
     * @returns {{ flow: Flow, did: string }}
     */
    actBy(chainId, input) {
      chatOf(chainId);
      const want = input?.flow == null ? "" : String(input.flow);
      const mine = [...store.list(chainId)].reverse().filter((f) => f.drives && (drivenLive(f) || f.state === "cut"));
      const flow = want ? mine.find((f) => f.id === want) : mine[0];
      if (!flow) throw refused(409, want ? `you drive no flow ${lineOf(want, 40)} now` : "you drive no flow now: one the person runs beside your chat is theirs to act on, and only they start one in place");
      /** @type {By} */
      const me = { by: "agent", why: clean(input?.why).slice(0, FLOW_LIMITS.line) };
      const action = String(input?.action ?? "").trim().toLowerCase();
      if (action === "stop") {
        api.stop(chainId, flow.id, me);
        return { flow, did: "stopped the flow" };
      }
      const at = boxOf(flow, String(input?.box ?? "").trim().toLowerCase());
      if (!at) throw refused(400, `name a box of the flow by its id ("box"): ${boxesOf(flow).map((x) => x.box.id).join(", ")}`);
      const box = at.box;
      if (box.kind === "review") throw refused(409, "the person's review is theirs alone: it waits for them, and you hear what they decide");
      const what = String(input?.do ?? "").trim().toLowerCase();
      if (what === "go" || what === "back") {
        if (flow.state !== "holds" || flow.hold?.kind !== "gate" || flow.hold.box !== box.id) throw refused(409, `the flow does not wait at ${box.name}: "go" and "back" answer a gate it waits at`);
        if (!me.why) throw refused(400, 'say why ("why"): the person reads it on the flow');
        api.decide(chainId, flow.id, what === "go" ? { action: "on" } : { action: "back", to: String(input?.to ?? "").trim().toLowerCase(), line: me.why }, me);
      } else if (what === "stop" || what === "skip" || what === "retry") api.box(chainId, flow.id, box.id, what, me);
      else throw refused(400, '"do" is stop, skip or retry — or, at a gate the flow waits at, go or back');
      // What it did, it knows: the next word it hears is what came of it.
      told.set(flow.id, newsMark(flow));
      return { flow, did: flow.acts?.at(-1)?.what || what };
    },
    /**
     * The person decides: at a gate that did not say go (§4.5) — `back` sends a box the gate needs back with the gate's
     * answer and their line, then the gate reads again; `on` goes on anyway; `stop` stops the flow — or at their review
     * (`box`, OA-D10): `on`, `back` to a box it needs, `stop`.
     * In place, the main agent decides at a gate too (`who`), and where the turn that drove the flow ended before it
     * (OA4 case 8), `on` goes on beside the chat and `stop` stops it.
     * @param {string} chainId @param {string} id @param {{ action?: unknown, box?: unknown, to?: unknown, line?: unknown }} input
     * @param {By} [who]  the person, or the main agent that drives it
     */
    decide(chainId, id, input = {}, who = PERSON) {
      const flow = flowIn(chainId, id);
      const asked = input.box != null ? boxOf(flow, String(input.box)) : null;
      if (asked?.box.kind === "review") return review(flow, asked, input);
      if (flow.state === "holds" && flow.hold?.kind === "driver") {
        if (input.action === "stop") return api.stop(chainId, id, who);
        if (input.action !== "on") throw refused(400, "your agent's turn ended before the flow did: go on beside your chat (action on), or stop it (action stop)");
        Object.assign(flow, { state: "running", hold: null, drives: false });
        did(flow, who, "went on with it beside the chat");
        save(flow);
        letGo(chainId);
        advance(flow);
        return view(flow);
      }
      if (flow.state !== "holds" || flow.hold?.kind !== "gate") throw refused(409, "the flow does not wait at a gate now");
      const at = boxOf(flow, flow.hold.box);
      if (!at) throw refused(409, "the gate the flow waits at is gone");
      const gate = at.box;
      if (input.action === "stop") return api.stop(chainId, id, who);
      if (input.action === "on") {
        gate.goneOn = true;
        flow.state = "running";
        flow.hold = null;
        did(flow, who, `went on past ${gate.name}'s ${gate.verdict ? "not yet" : "missing verdict"}`);
        save(flow);
        advance(flow);
        return view(flow);
      }
      if (input.action !== "back") throw refused(400, "action is back (with to: a box the gate needs), on or stop");
      const target = boxOf(flow, String(input.to ?? ""));
      if (!target || !gate.needs.includes(target.box.id)) throw refused(400, "send it back to a box the gate needs");
      if (target.box.kind === "review") throw refused(400, NO_REVIEW_BACK);
      const line = clean(input.line);
      if (line.length > FLOW_LIMITS.line) throw refused(400, `your line is ${FLOW_LIMITS.line} characters at most; this is ${line.length}`);
      const answer = String(gate.result?.text || "");
      gate.past.push({ verdict: gate.verdict, at: gate.endedAt || now(), text: answer });
      keepRan(gate);
      Object.assign(gate, { state: "waits", verdict: null, result: null, run: null, error: null, goneOn: false, startedAt: null, endedAt: null });
      gate.sends = (gate.sends || 0) + 1;
      target.box.sentBack += 1;
      flow.sentBack += 1;
      flow.state = "running";
      flow.hold = null;
      sendBack(flow, target.box, target.step, { gate: gate.name, answer, line, by: who.by });
      did(flow, { by: who.by, why: line || who.why }, `sent ${target.box.name} back from ${gate.name}`);
      save(flow);
      if (target.box.state === "failed") advance(flow);
      return view(flow);
    },
    /**
     * One box: `stop` its run; `skip` it (it hands on nothing, and the boxes after it are told so); `retry` it, as
     * it failed, stopped or was cut; `hand-on` a team's reply that ends on a question; `take` a team's newer reply
     * as its result, before the step after it started.
     * @param {string} chainId @param {string} id @param {string} bid @param {string} act @param {By} [who]  the person, or the main agent that drives it
     */
    box(chainId, id, bid, act, who = PERSON) {
      const flow = flowIn(chainId, id);
      const at = boxOf(flow, bid);
      if (!at) throw refused(404, "no box of this flow answers to that id");
      const { box, step } = at;
      if (flow.state === "done" || flow.state === "stopped") throw refused(409, "the flow has ended");
      if (flow.state === "draft") throw refused(409, "the flow has not started: change the draft instead");
      /** The flow goes on, where it held for this box. */
      const unhold = () => {
        if (flow.state === "holds" && flow.hold?.box === box.id) {
          flow.state = "running";
          flow.hold = null;
        }
      };
      if (act === "stop") {
        if (box.kind === "review") throw refused(409, "your review has no run to stop: go on, send back, or stop the flow");
        if (!live(box)) throw refused(409, `${box.name} is not at work`);
        did(flow, who, `stopped ${box.name}`);
        // A team box whose lead still starts has no run to stop yet: it stops once it has, or never starts.
        if (box.kind === "team" && !box.run) /** @type {any} */ (box).stopping = true;
        save(flow);
        stopRun(box);
        return view(flow);
      }
      if (act === "skip") {
        if (box.state === "done" || box.state === "skipped") throw refused(409, `${box.name} is ${box.state} already`);
        did(flow, who, `skipped ${box.name}`);
        if (live(box)) {
          /** @type {any} */ (box).skipping = true;
          save(flow);
          stopRun(box);
          if (box.kind !== "agent" || !box.run) boxEnds(flow, box, "skipped", "");
          return view(flow);
        }
        Object.assign(box, { state: "skipped", error: null, endedAt: now() });
        // A box a restart cut, skipped: the flow goes on from it, as a retry's does.
        if (flow.state === "cut") flow.state = "running";
        unhold();
        save(flow);
        advance(flow);
        return view(flow);
      }
      if (act === "retry") {
        if (!["failed", "stopped", "cut"].includes(box.state)) throw refused(409, `${box.name} has not failed or stopped`);
        if (flow.state === "cut") flow.state = "running";
        did(flow, who, `retried ${box.name}`);
        unhold();
        again(flow, box, step);
        save(flow);
        if (box.state === "failed") advance(flow);
        return view(flow);
      }
      if (act === "hand-on") {
        if (box.kind !== "team" || box.state !== "asking" || !box.result) throw refused(409, `${box.name} has no reply to hand on`);
        /** @type {any} */ (box).handOn = true;
        Object.assign(box, { state: "done", error: null, endedAt: now() });
        did(flow, who, `handed on ${box.name}'s reply, question and all`);
        if (box.run?.team) teamChats.delete(box.run.team);
        save(flow);
        advance(flow);
        return view(flow);
      }
      if (act === "take") {
        if (box.kind !== "team" || box.state !== "done" || !box.run?.team) throw refused(409, `${box.name} is no team box that is done`);
        if (flow.steps.slice(step + 1).some((s) => s.boxes.some((b) => b.state !== "waits"))) throw refused(409, "the step after it has started: it was handed the reply it ended on");
        /** @type {any} */
        let f = null;
        try {
          f = sessions.besideFacts(box.run.team);
        } catch {
          throw refused(409, `${possessive(box.name)} chat is gone: it has no reply to hand on`);
        }
        if (!f?.last?.final) throw refused(409, `${box.name}'s chat has no reply to hand on now`);
        box.result = { text: String(f.last.text || ""), n: Number(f.last.n) || 0, at: now() };
        did(flow, who, `took ${box.name}'s newer reply as its result`);
        save(flow);
        return view(flow);
      }
      throw refused(400, "a box's act is stop, skip, retry, hand-on or take");
    },
    /**
     * Stop a flow: every box at work stops, as a team or a sub-agent stops today, and a review that waited stops with
     * it; the flow says stopped.
     * @param {string} chainId @param {string} id @param {By} [who]  the person, or the main agent that drives it
     */
    stop(chainId, id, who = PERSON) {
      const flow = flowIn(chainId, id);
      if (flow.state === "done" || flow.state === "stopped") throw refused(409, "the flow has ended");
      if (flow.state === "draft") throw refused(409, "the flow has not started: discard the draft instead");
      halt(flow, who, "stopped the flow");
      return view(flow);
    },
    /**
     * Go on with a flow a restart stopped (FL-D19): its team boxes go on from where they were cut, its cut agent boxes
     * start again; done boxes stay done. The person's one press.
     * @param {string} chainId @param {string} id
     */
    goOn(chainId, id) {
      const flow = flowIn(chainId, id);
      if (flow.state !== "cut") throw refused(409, "the flow was not stopped by a restart");
      // Driven In place, with no turn of the chat that drives it now: the person's Go on runs it beside the chat (OA4).
      if (flow.drives) {
        /** @type {any} */
        let f = null;
        try {
          f = sessions.besideFacts(chainId);
        } catch {}
        if (!f?.busy) {
          flow.drives = false;
          told.delete(flow.id);
        }
      }
      did(flow, PERSON, flow.drives ? "went on after the restart" : "went on after the restart, beside the chat");
      flow.state = "running";
      flow.hold = null;
      for (const { box, step } of boxesOf(flow)) if (box.state === "cut") again(flow, box, step);
      save(flow);
      advance(flow);
      return view(flow);
    },
    /**
     * The end message again, where it did not go — Filament stopped while it waited, or the main chat refused it.
     * @param {string} chainId @param {string} id
     */
    send(chainId, id) {
      const flow = flowIn(chainId, id);
      if (flow.state !== "done" || !flow.end) throw refused(409, "the flow has no end message");
      if (flow.end.sent) throw refused(409, "its end message went already");
      if (endWaits.has(flow.id)) throw refused(409, "its end message waits for your chat's turn to end");
      flow.end.missed = null;
      void sendEnd(flow);
      return view(flow);
    },
    /**
     * A draft discarded, or an ended flow taken off the list. One that runs is stopped first.
     * @param {string} chainId @param {string} id
     */
    remove(chainId, id) {
      const flow = flowIn(chainId, id);
      if (flow.state === "running" || flow.state === "holds" || flow.state === "cut") throw refused(409, "the flow has not ended: stop it first");
      store.remove(chainId, id);
      atWork?.delete(id);
      told.delete(id);
      askAnswered(chainId, id);
      events.publish("turns", { type: "flow", chainId, id, state: "removed" });
      letGo(chainId);
      return { ok: true };
    },
    /**
     * A flow deleted from the Agents tab (the owner's ask of 10-23): taken off the chat's list as Remove takes it, and
     * what it ran with it — its boxes' threads, each run they had, and its teams' chats. Its worktree and branch stay:
     * nothing of them is deleted. Refused, as Remove is, until it ended. A thread or a chat that will not go stays, and
     * the log says why. → how many threads and team chats went.
     * @param {string} chainId @param {string} id @returns {Promise<{ ok: true, threads: number, teams: number }>}
     */
    async removeAll(chainId, id) {
      const flow = flowIn(chainId, id);
      const subIds = [...new Set(boxesOf(flow).flatMap((x) => [x.box.run?.sub, ...(x.box.ran || [])]).filter((s) => typeof s === "string"))];
      const chats = /** @type {any[]} */ (besides()?.list(chainId) || []).filter((r) => r.flow?.id === id).map((r) => String(r.id));
      api.remove(chainId, id);
      let threads = 0;
      for (const sub of subIds) {
        const out = await registry()?.forget?.(sub, chainId);
        if (out?.ok) threads += 1;
        else if (out && out.status !== 404) log("warn", `flows: ${id}'s thread ${sub} stays (${out.error})`);
      }
      let teams = 0;
      for (const chat of chats) {
        try {
          await besides().drop(chat, { flow: true });
          teams += 1;
        } catch (/** @type {any} */ e) {
          log("warn", `flows: ${id}'s team chat ${chat} stays (${e?.message || e})`);
        }
      }
      log("info", `flows: ${id} deleted from ${chainId}, with ${threads} threads and ${teams} team chats`);
      return { ok: true, threads, teams };
    },
    /**
     * A drawn flow kept to start again (F6): its steps and boxes — each box's needs, each step's why — without its words.
     * @param {string} chainId @param {string} id @param {{ name?: unknown }} input
     */
    keep(chainId, id, input = {}) {
      if (!saved) throw refused(409, "saved flows need Filament's data folder");
      const flow = flowIn(chainId, id);
      return saved.save({ name: input.name ?? flow.title, steps: stepsInput(flow) });
    },
    /**
     * A draft from a saved flow (F6): its steps, the person's words its goal.
     * @param {string} chainId @param {unknown} key @param {unknown} goal
     */
    fromSaved(chainId, key, goal) {
      const s = saved?.find(key);
      if (!s) throw refused(404, `no saved flow answers to "${String(key ?? "")}"`);
      return api.create(chainId, { title: s.name, goal: clean(goal), steps: s.steps }, { drawn: "saved" });
    },
    /**
     * As Filament starts (FL-D19): a flow that ran when it stopped says "Stopped by a restart" — each box at work then
     * says so too — and goes on only on the person's Go on. One that waited at a gate, or for the person's review
     * alone, still waits. One its main agent drove In place (OA4 case 7) is told it, with the turn that goes on by itself:
     * the boxes cut are the agent's to retry or skip.
     */
    reconcile() {
      let n = 0;
      for (const chainId of store.chats())
        for (const flow of store.list(chainId)) {
          if (flow.drives && flow.state === "cut") told.set(flow.id, newsMark(flow));
          if (flow.state !== "running" && flow.state !== "holds") continue;
          /** @type {string[]} */
          const cut = [];
          for (const { box } of boxesOf(flow))
            if (live(box) && box.kind !== "review") {
              Object.assign(box, { state: "cut", error: "Filament restarted while it worked", endedAt: now() });
              cut.push(box.name);
              if (box.kind === "team" && !box.run) adopt(flow, box);
            }
          if (!cut.length && (flow.state === "holds" || boxesOf(flow).some((x) => x.box.kind === "review" && x.box.state === "asking"))) {
            if (flow.drives) tellRestart(flow, []);
            continue;
          }
          flow.state = "cut";
          flow.hold = null;
          store.put(chainId, flow);
          keepAtWork(flow);
          n += 1;
          if (flow.drives) tellRestart(flow, cut);
        }
      return n;
    },
    /**
     * What a turn of the chat may not end before while its main agent drives a flow In place (OA4): a promise that
     * settles once none is driven and running — the flow ended, or the person went on beside the chat — else null.
     * The sub-agents' registry waits on it beside the turn's own launches; each word of the flow wakes the turn there.
     * @param {string} chainId @returns {Promise<void> | null}
     */
    drives(chainId) {
      const id = String(chainId || "");
      if (!flowsOf(id).some(drivenLive)) return null;
      let w = drivesOwed.get(id);
      if (!w) {
        let done = () => {};
        const p = new Promise((res) => (done = () => res(undefined)));
        w = { p, done };
        drivesOwed.set(id, w);
      }
      return w.p;
    },
    /** Whether the chat's main agent drives a flow that runs or holds (OA4): its wait says so. @param {string} chainId */
    driven: (chainId) => flowsOf(String(chainId || "")).some(drivenLive),
    /** A chat goes: its flows go with it, each box at work stopped, and out of the list at work (the Hunter's of 10-28). @param {string} chainId */
    drop(chainId) {
      for (const flow of store.list(chainId)) {
        for (const { box } of boxesOf(flow)) if (live(box)) stopRun(box);
        atWork?.delete(flow.id);
      }
      store.drop(chainId);
      letGo(chainId);
    },
    /** Filament stops: nothing more is heard, and no flow moves on. */
    close() {
      closedDown = true;
      for (const off of offs) off?.();
    },
  };
  return api;
}

/** @typedef {ReturnType<typeof createFlowRunner>} FlowRunner */
/** A flow at work, for Now: its chat, its id, running, holding or cut by a restart, its line, whether it asks the person, and since when. @typedef {{ chainId: string, id: string, state: "running" | "holds" | "cut", line: string, asks: boolean, at: number }} FlowAtWork */
