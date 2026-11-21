// @ts-check
// The line over the composer for a draft that starts with a saved agent's tag (HarnessV4_Tasks E15 step 2): who gets
// the draft, on which model, what they are shown and how large that is, and that the main agent hears nothing —
// "To Product and End user · GLM-5.3 · sees this session and the turn running now, 38k tokens · not to the main agent".
// One agent, in a session whose pool holds models of two makers or more, can be asked once on each (step 8, AG-241):
// the line's choice "one per model family" — "To Product, three times · GLM-5.3, Claude Haiku 5.5 and GPT-5.6 · each
// blind to the others · …" — and "once" takes it back.
// A range named after the tags (`@security since:v1.2 …`, step 4) is said there too: "with the changes since v1.2".
// The same line says why such a draft does not go yet: nothing asked, more agents than the session has room for. And
// it holds a draft whose first `@word` names no agent, once (AG-4): pick an agent — the nearest to what was typed
// stand first — or send it to the main agent as written.
// A draft to the main agent that names saved agents past its start (the owner's words of 10-19: "anywhere in the
// message") says whom Filament asks too, and that their answers come back to the main agent by themselves — "Also to
// Product · GLM-5.3 · its answer comes back to your agent, which waits for it".
import { h } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";
import { prettyModel } from "../lib/families.js";
import { addressed, handedWords, listed, nearestCards, teamAddressed, teamUsesIn, usesIn } from "../lib/agent-cards.js";

/**
 * What the line says of the open session, as the app keeps it.
 * @typedef {{ defaultModel: string, tokens: Record<string, number> | null, running: boolean,
 *   runningTokens: number, limit: { max: number | null, running: number } | null, refusedPictures: (model: string) => boolean,
 *   families: { family: string, model: string }[] }} AskFacts
 *   `defaultModel`: what a card that names no model runs on here; `tokens`: each view's size, null until read;
 *   `running`: a turn runs now, and `runningTokens` is its size so far (0 until read); `limit`: the session's limit
 *   and how many agents run; `refusedPictures`: whether this model's provider refused a request with pictures before;
 *   `families`: the first model of each maker in the session's pool (lib/pool.js `poolFamilies`) — with two or
 *   more, one saved agent can be asked once on each (step 8, AG-241)
 */

/** "twice" · "three times": how often one agent is asked. @param {number} n */
const timesWords = (n) => (n === 2 ? "twice" : `${["", "", "", "three", "four", "five", "six", "seven", "eight"][n] || n} times`);

/**
 * The line's words for a draft addressed to saved agents.
 * @param {{ to: import("../lib/agent-cards.js").AgentCard[], question: string, changes?: string | null, files: number, pictures: number, spread?: boolean }} d
 *   `changes`: the change the draft hands them as a patch (`since:v1.2`); `spread`: one per model family was chosen
 * @param {AskFacts} f
 * @returns {{ who: string, facts: string[], stop: string | null, note: string | null, canSpread: boolean, models: string[] | null }}
 *   `stop`: why the draft does not go yet, else null; `note`: what the person should know before sending;
 *   `canSpread`: the draft is one agent's and the pool holds models of two makers or more; `models`: the models
 *   it is asked on, one launch each, where that was chosen — else null
 */
export function askLineWords(d, f) {
  const names = d.to.map((c) => c.name);
  const modelOf = (/** @type {import("../lib/agent-cards.js").AgentCard} */ c) => c.model || f.defaultModel;
  const canSpread = d.to.length === 1 && f.families.length > 1;
  const spread = canSpread && d.spread === true ? f.families.map((x) => x.model) : null;
  const models = spread || [...new Set(d.to.map(modelOf).filter(Boolean))];
  /** How many launches the draft is. */
  const count = spread ? spread.length : d.to.length;
  /** The way to fewer launches: one agent on several models is asked once instead. */
  const fewer = spread ? "ask once" : "ask fewer";
  const viewOf = (/** @type {import("../lib/agent-cards.js").AgentCard} */ c) => c.sees.view;
  const views = [...new Set(d.to.map(viewOf))];
  // The context window holds the turn running now already.
  const seesRunning = f.running && d.to.some((c) => c.sees.running && viewOf(c) !== "window");
  const turn = seesRunning ? Number(f.runningTokens) || 0 : 0;
  /** @param {number} n */
  const sized = (n) => (n ? `, ${fmt.k(n)} tokens` : "");
  let sees;
  if (views.length > 1) sees = "each sees what its card says";
  else if (views[0] === "none") sees = seesRunning ? `sees your question and the turn running now${sized(turn)}` : "sees your question alone";
  else if (views[0] === "window") sees = `sees the main agent's context window${sized(f.tokens ? Number(f.tokens.window) || 0 : 0)}`;
  else {
    const size = f.tokens ? Number(f.tokens[views[0]]) || 0 : null;
    sees = size === 0 && !seesRunning ? "this chat has nothing to show yet" : `sees this session${seesRunning ? " and the turn running now" : ""}${sized((size || 0) + turn)}`;
  }
  const facts = [spread ? listed(models.map((m) => prettyModel(m))) : models.map((m) => prettyModel(m)).join(" and "), spread ? "each blind to the others" : "", sees, handedWords(d.changes), "not to the main agent"].filter(Boolean);
  // A limit is the chat's models' own, set under their providers; none set, none (`max` null).
  const max = f.limit && f.limit.max != null ? f.limit.max : null;
  const room = f.limit && max != null ? max - f.limit.running : Infinity;
  // More than its models ever run at once: waiting for one to finish would not help.
  const stop = !d.question ? `Ask ${listed(names)} something`
    : max != null && count > max
      ? `This chat's models run ${max} agent${max === 1 ? "" : "s"} at once: ${count} do not fit — ${fewer}`
    : count > room && f.limit
      ? `${f.limit.running} of ${max} agent${max === 1 ? " is" : "s are"} running: ${count === 1 ? "one more does" : `${count} more do`} not fit — wait for one to finish${count > 1 && room > 0 ? `, or ${fewer}` : ""}`
      : null;
  const blindModels = spread && d.pictures ? spread.filter((m) => f.refusedPictures(m)) : [];
  const blind = !spread && d.pictures ? d.to.filter((c) => f.refusedPictures(modelOf(c))) : [];
  const note = blindModels.length
    ? `${listed(blindModels.map((m) => prettyModel(m)))} was refused a picture before, so ${names[0]} may fail there on ${d.pictures === 1 ? "this one" : "these"}`
    : blind.length
      ? `${listed([...new Set(blind.map((c) => prettyModel(modelOf(c))))])} was refused a picture before, so ${listed(blind.map((c) => c.name))} may fail on ${d.pictures === 1 ? "this one" : "these"} — put a model that reads pictures on the card`
      : null;
  return { who: spread ? `${names[0]}, ${timesWords(spread.length)}` : listed(names), facts, stop, note, canSpread, models: spread };
}

/**
 * The line's words for a draft to the main agent that names agents or teams with an `@` past its start (`usesIn`,
 * `teamUsesIn`; HarnessV4_OneAgent_Plan OA2): whom it names for the main agent to use, and that nothing starts at Send —
 * the main agent is told to use them when the work is ready for them.
 * @param {readonly { name: string }[]} agents @param {readonly { name: string }[]} teams
 * @returns {{ who: string, facts: string[] }}
 */
export function useLineWords(agents, teams) {
  return { who: listed([...agents.map((c) => c.name), ...teams.map((t) => `the ${t.name} team`)]), facts: ["nothing starts at Send"] };
}

/**
 * @param {{ cards: () => import("../lib/agent-cards.js").AgentCard[], facts: () => AskFacts, onPick: (word: string, tag: string) => void, onChoice?: () => void, mk?: typeof h,
 *   teams?: () => { key: string, name: string }[], uses?: () => { key: string, name: string }[], whyNoBrief?: () => string | null }} o
 *   `onPick`: an agent chosen for a held draft's unknown word — the draft's word becomes that tag; `onChoice`: a
 *   choice was made on the line itself, which drew it again — the box takes the keyboard back, so Enter sends; `teams`:
 *   the teams a draft may start on the side by naming them; `uses`: the teams a message may name for the main agent to
 *   use past its start — every team, where no Brief can open (a new chat's first message), else `teams`; `whyNoBrief`:
 *   why no team's Brief opens from this chat now, in a sentence with no full stop, else null
 */
export function createAskLine({ cards, facts, onPick, onChoice, mk = h, teams = () => [], uses = teams, whyNoBrief = () => null }) {
  const el = mk("div", { class: "ask-line hidden", role: "status", "aria-live": "polite" });
  /**
   * The draft held because its first word names no agent, or a word past its start names no agent and no team
   * (`later`), and that word. @type {{ text: string, word: string, later: boolean } | null}
   */
  let held = null;
  /** The line's stop was pressed against: it is drawn stronger until the draft changes. */
  let pressed = "";
  /** One per model family was chosen for the draft's one agent (AG-241): held while the draft stays that agent's. */
  let spread = "";
  /** What the line was last painted with, for a choice made on the line itself. @type {{ text: string, files: any[] }} */
  let last = { text: "", files: [] };
  /** The draft's words for the line. @param {ReturnType<typeof addressed>} who @param {any[]} files */
  const wordsOf = (who, files) =>
    askLineWords({ to: who.to, question: who.question, changes: who.changes, files: files.length, pictures: files.filter((a) => a.kind === "image").length, spread: who.to.length === 1 && spread === who.to[0].tag }, facts());

  /** @param {string} text @param {any[]} files */
  const paint = (text, files) => {
    last = { text, files };
    const draft = String(text || "").trim();
    if (held && held.text !== draft) held = null;
    if (pressed && pressed !== draft) pressed = "";
    if (held) {
      el.className = "ask-line is-held";
      // Its first word is a team's where no Brief opens (d-side, 11-12: the Library's foot copies `@bughunters` for a
      // chat's box, and a chat not yet begun read it as an agent nobody is called): what it is and why not here.
      const team = held.later ? null : uses().find((t) => String(t.key).toLowerCase() === held?.word.toLowerCase());
      if (team) {
        el.replaceChildren(
          mk("span", { class: "ask-warn" }, `${team.name} is a team.`),
          mk("span", { class: "ask-facts" }, ` ${whyNoBrief() || "Its Brief does not open here"}. Or press Enter again to send this to the main agent as written`));
        return;
      }
      el.replaceChildren(
        mk("span", { class: "ask-warn" }, `No agent is called @${held.word}`),
        mk("span", { class: "ask-facts" }, held.later ? " — pick one, or press Enter again to send it as written" : " — pick one, or press Enter again to send this to the main agent as written"),
        mk("span", { class: "ask-picks" }, ...nearestCards(held.word, cards()).map((c) => {
          const word = held ? held.word : "";
          return mk("button", { class: "ask-pick", type: "button", title: `${c.name}: ${c.goodFor}`, onclick: () => onPick(word, c.tag) }, `@${c.tag}`);
        })));
      return;
    }
    // A draft that opens with a team's name is the team's (U13-D13): Enter opens its Brief, and nothing starts before
    // the Brief's Send.
    const opens = teamAddressed(draft, teams());
    if (opens) {
      spread = "";
      el.className = "ask-line is-team";
      el.replaceChildren(
        mk("span", { class: "ask-to" }, "To the "),
        mk("b", { class: "ask-who ask-teams" }, opens.team.name),
        mk("span", { class: "ask-facts" }, ` team · Enter opens its Brief with ${opens.ask ? "your words" : "nothing asked yet"} — on the side or in charge; nothing starts until you send it there`));
      return;
    }
    const who = addressed(draft, cards(), teams());
    // The choice is the draft's one agent's: another agent, a second one or none, and it is not chosen.
    if (spread && (who.to.length !== 1 || who.to[0].tag !== spread)) spread = "";
    if (!who.to.length) {
      // A draft to the main agent that names agents or teams with an `@` in its words (HarnessV4_OneAgent_Plan OA2):
      // nothing starts at Send — the main agent is told to use them, and the line says whom before it goes.
      const agents = usesIn(draft, cards(), uses());
      const sides = teamUsesIn(draft, cards(), uses());
      if (!agents.length && !sides.length) {
        el.className = "ask-line hidden";
        el.replaceChildren();
        return;
      }
      const u = useLineWords(agents, sides);
      el.className = "ask-line is-use";
      el.replaceChildren(
        mk("span", { class: "ask-to", title: "Named with @: your agent gets your message and Filament's line telling it to use them when the work is ready; the turn says if it did not" }, "For your agent to use: "),
        mk("b", { class: `ask-who${sides.length && !agents.length ? " ask-teams" : ""}` }, u.who),
        mk("span", { class: "ask-facts" }, ` · ${u.facts.join(" · ")}`));
      return;
    }
    const w = wordsOf(who, files);
    const one = who.to[0];
    const each = listed(facts().families.map((x) => prettyModel(x.model)));
    el.className = `ask-line${w.stop && pressed ? " is-stopped" : ""}`;
    el.replaceChildren(
      mk("span", { class: "ask-to" }, "To "),
      mk("b", { class: "ask-who" }, w.who),
      mk("span", { class: "ask-facts" }, ` · ${w.facts.join(" · ")}`),
      ...(w.canSpread
        ? [mk("button", {
            class: "ask-pick ask-spread", type: "button", "aria-pressed": w.models ? "true" : "false",
            title: w.models ? `Ask ${one.name} once, on one model` : `Ask ${one.name} once on each of ${each}: the first model of each maker in this session's pool, each answer blind to the others`,
            onclick: () => { spread = w.models ? "" : one.tag; paint(last.text, last.files); onChoice?.(); },
          }, w.models ? "once" : "one per model family")]
        : []),
      ...(w.stop ? [mk("span", { class: "ask-stop" }, w.stop)] : []),
      ...(w.note ? [mk("span", { class: "ask-warn" }, w.note)] : []));
  };

  return {
    el,
    paint,
    /**
     * Whom the draft is for, why it does not go yet, and the models its one agent is asked on where one per model
     * family is chosen (`models`, else null); `team`: the team it opens with, whose Brief Enter opens (U13-D13).
     * @param {string} text @param {any[]} files
     */
    read(text, files) {
      const draft = String(text || "").trim();
      const team = teamAddressed(draft, teams());
      const who = addressed(draft, cards(), teams());
      const w = who.to.length && !team ? wordsOf(who, files) : null;
      return { ...who, ...(team ? { to: [], team } : {}), stop: w ? w.stop : null, models: w ? w.models : null };
    },
    /** Enter was pressed against the line's stop: it shows stronger. @param {string} text */
    press(text) { pressed = String(text || "").trim(); },
    /**
     * Hold a draft whose first word names no agent, or (`later`) a word past its start no agent and no team.
     * @param {string} text @param {string} word @param {{ later?: boolean }} [o]
     */
    hold(text, word, { later = false } = {}) { held = { text: String(text || "").trim(), word, later }; },
    /** Whether this draft was held and is sent again as written; the hold ends with the answer. @param {string} text */
    passes(text) {
      if (!held || held.text !== String(text || "").trim()) return false;
      held = null;
      return true;
    },
  };
}
