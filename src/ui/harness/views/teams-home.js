// @ts-check
// The Teams tab's home (team_v2_plan §10 O1, the mock of 10-19; the rework of 11-11: the teams first, the lesson
// folded): what a team is, in one line; the teams as squads — a lead with a crown, its workers as portraits — grouped
// They look and check / They build, each saying what its lead and workers run on, with Brief…; Make your own team;
// then How teams work, one fold whose line says the two ways — On the side and In charge — and which opens on the two
// side by side, each with a picture of who talks to whom and where the result goes, as the person left it (kept in
// this browser, for every chat); and three rules. Brief… opens the Brief (views/brief.js); nothing here starts
// anything. The words are lib/brief.js's; every press goes through the host (app.js).
import { h, morphChildren } from "../../lib/dom.js";
import { store } from "../../lib/store.js";
import { ICONS } from "../lib/icons.js";
import { prettyModel } from "../lib/families.js";
import { kids } from "../widgets/kit.js";
import { HOW_PREF, WAYS, groupsOf, leadLook, memberLook, ownModels, usualWay } from "../lib/brief.js";
import { BUILD_TEAM, isBuildTeam } from "../lib/agent-cards.js";
import { BUGHUNTERS } from "../lib/beside.js";
import { possessive } from "../lib/labels.js";

/**
 * What the home reads and does — the host's.
 * @typedef {{
 *   teams: () => any[],
 *   model: () => string,
 *   seats: () => string[],
 *   brief: (fill: import("./brief.js").BriefFill) => void,
 *   newTeam: () => void,
 *   library: () => void,
 *   armed?: () => { team: string, name: string } | null,
 *   disarm?: () => void,
 * }} TeamsHomeIO  `seats`: this chat's list's models, in order; `brief`: the Brief, opened as a press asks;
 *   `newTeam`: a new team's editor; `library`: Library › Agents and teams; `armed`: a hand-over that waits for the
 *   running turn's end, and `disarm` takes it back
 */

/**
 * @param {TeamsHomeIO} io
 * @param {{ h?: typeof h, place?: (parent: any, wanted: any[]) => void, drawIn?: (parent: any, nodes: any[]) => void,
 *   store?: { get: (k: string) => string | null, set: (k: string, v: string) => void } }} [o]  the tests' fake DOM, its
 *   way into a host (`drawIn`; `place` is the team view's), and where How teams work is kept open or folded
 * @returns {{ top: any, roster: any, paint: (chat: any) => void }}
 */
export function createTeamsHome(io, o = {}) {
  const mk = o.h || h;
  const keep = o.store || store;
  // Drawn again as what it says moves — a seat taken or freed among them —: in place, its Brief… and Edit in Library
  // under a resting pointer the elements they were (the owner's of 11-01: buttons blinking, clicks lost).
  const drawIn = o.drawIn || morphChildren;
  /** @param {string} name @param {string} [cls] */
  const glyph = (name, cls = "inst-ic") => mk("span", { class: cls, html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });
  /** @param {{ icon: string, tone: string }} look @param {string} size @param {{ crown?: boolean, cls?: string }} [x] */
  const portrait = (look, size, x = {}) =>
    mk("span", { class: `pf ${size} t-${look.tone}${x.cls ? ` ${x.cls}` : ""}`, "aria-hidden": "true" }, glyph(look.icon, "pf-ic"), x.crown ? glyph("crown", "pf-crown") : null);

  /** How teams work, open on the two ways: as the person left it, folded until they open it. */
  let open = keep.get(HOW_PREF) === "1";
  /** What the home drew last, so a pulse that changes nothing leaves it be. */
  let key = "";

  const top = mk("div", { class: "th-top" });
  const roster = mk("div", { class: "th-roster-wrap" });

  /** The picture of a way: who talks to whom, and where the result goes. @param {"side" | "charge"} way @param {any} sideTeam @param {any} chargeTeam */
  const picture = (way, sideTeam, chargeTeam) => {
    const you = () => portrait({ icon: "user", tone: "you" }, "s32");
    const agent = (/** @type {string} */ cls = "") => portrait({ icon: "bot", tone: "agent" }, "s32", { cls });
    if (way === "side") {
      const lead = leadLook(String(sideTeam?.key || BUGHUNTERS));
      const m = memberLook((sideTeam?.members || [])[0] || { tag: "reviewer", may: "read", place: "reviewer" });
      return mk("div", { class: "th-dg" },
        mk("div", { class: "th-lane" }, you(), glyph("arrowRightLeft", "th-arr"), agent("ring-blue"),
          mk("span", { class: "th-lt" }, mk("b", {}, "You and your agent"), mk("br"), "keep going — nothing changes for them")),
        mk("div", { class: "th-rule" }, mk("span", {}, "its lead gets a copy of this chat")),
        mk("div", { class: "th-lane" }, portrait(lead, "s32", { crown: true }), glyph("arrowRight", "th-arr"),
          mk("span", { class: "th-row" }, portrait(m, "s24"), portrait(m, "s24"), portrait(m, "s24"), mk("span", { class: "th-mul" }, "× many")),
          glyph("arrowRight", "th-arr"), mk("span", { class: "th-respill" }, glyph("fileText", "th-respill-ic"), "Result"), glyph("arrowRight", "th-arr"), you(),
          mk("span", { class: "th-lt" }, mk("b", {}, "comes to you"), mk("br"), "not to your agent")));
    }
    const lead = leadLook(String(chargeTeam?.key || BUILD_TEAM));
    return mk("div", { class: "th-dg" },
      mk("div", { class: "th-lane" }, you(), glyph("arrowRightLeft", "th-arr"), portrait(lead, "s32", { crown: true, cls: "ring-gold" }), glyph("arrowRight", "th-arr is-gold"),
        mk("span", { class: "th-row" }, ...(chargeTeam?.members || []).slice(0, 4).map((/** @type {any} */ x) => portrait(memberLook(x), "s24"))),
        mk("span", { class: "th-lt" }, mk("b", {}, "You and the lead"), mk("br"), "it plans, hands out the work, checks it")),
      mk("div", { class: "th-rule" }, mk("span", {}, "your agent steps aside")),
      mk("div", { class: "th-lane" }, agent("is-dim"),
        mk("span", { class: "th-lt" }, mk("b", {}, "Your agent"), " waits · ", mk("b", { class: "th-blue" }, "Back to your agent"), " gives it the chat again, any time")));
  };

  /** @param {string} icon @param {string} tone @param {...any} words */
  const fact = (icon, tone, ...words) => mk("div", { class: "th-fact" }, glyph(icon, `th-soft t-${tone}`), mk("span", {}, ...words));

  /** @param {"side" | "charge"} way @param {any[]} teams */
  const wayCard = (way, teams) => {
    const g = groupsOf(teams);
    const sideTeam = g.look.find((t) => t.key === BUGHUNTERS) || g.look[0] || null;
    const chargeTeam = g.build.find(isBuildTeam) || g.build[0] || null;
    const side = way === "side";
    return mk("section", { class: `th-way is-${way}` },
      mk("div", { class: "th-way-head" }, glyph(side ? "columns2" : "crown", `th-way-tile t-${side ? "blue" : "yellow"}`),
        mk("div", { class: "th-way-text" },
          mk("div", { class: "th-way-name" }, WAYS[way].label, mk("span", { class: `th-tag is-${way}` }, side ? "Start here" : "For big jobs")),
          mk("span", { class: "th-way-sub" }, WAYS[way].short))),
      picture(way, sideTeam, chargeTeam),
      mk("div", { class: "th-facts" }, ...(side
        ? [
            fact("fileText", "blue", "Its lead reads ", mk("b", {}, "this whole chat"), " — even the turn running now — then ", mk("b", {}, "your words"), "."),
            fact("eyeOff", "gray", "Your agent hears nothing of it until you send it there."),
            fact("squareStack", "blue", "Several teams can be out at once. Each shows here, live."),
          ]
        : [
            fact("fileText", "yellow", "Its lead reads ", mk("b", {}, "this whole chat"), ", then answers your next message here."),
            fact("gitBranch", "orange", "Workers that change files work in ", mk("b", {}, "their own copy"), "; the lead brings changes into your folder. Nothing is committed."),
            fact("circleDollar", "gray", "Costs once: your provider caches this chat again for the lead. The Brief says how much."),
          ])),
      mk("div", { class: "th-pick" }, mk("span", {}, "Good for"), ...(side ? ["a bug hunt", "checking work", "a review", "a second opinion"] : ["a feature in many parts", "a big refactor", "work you want split"]).map((w) => mk("span", { class: "th-chip" }, w))));
  };

  /** What a team's lead and workers run on, in a squad's foot. @param {any} t */
  const onLines = (t) => {
    const members = Array.isArray(t.members) ? t.members : [];
    const who = members.length === 1 ? `${members[0].name}s` : "Workers";
    const seats = io.seats();
    const model = io.model();
    const models = Array.isArray(t.models) ? t.models.filter(Boolean) : [];
    const leads = Array.isArray(t.leadModels) && t.leadModels.length ? t.leadModels : t.leadModel ? [t.leadModel] : [];
    const charge = usualWay(t) === "charge";
    // As the server runs it (teams-beside.js `runsOn`; the review of 0376f5a4f): in charge its lead is this chat's model,
    // beside it the team's, else its card's, else this chat's; its workers on the team's, else each card's, else this
    // chat's list — with none of its own, its lead's model. Each line names the model the page knows, with whose it is
    // (the rework of 11-11: a model said as a model); the rule whole is the line's tip.
    /** On the side, the team names its lead's models. */
    const named = !charge && leads.length > 0;
    /** The model its lead runs on, "" where this chat's is not known yet. */
    const leadOn = named ? String(leads[0]) : model;
    // On the side with no model of the team's, its lead's card comes first, and the page holds no card of a lead: said.
    const card = charge ? "" : ", unless its card names one";
    const lead = named ? [mk("b", {}, `${prettyModel(leadOn)} on the side`)] : leadOn ? [mk("b", {}, prettyModel(leadOn)), ` · this chat's${card}`] : [mk("b", {}, "this chat's model"), ...(card ? [card] : [])];
    const leadTip = charge ? "In charge, its lead runs on this chat's model"
      : named ? "On the side, its lead runs on the team's models, first choice first; in charge, on this chat's model"
        : "On the side, its lead runs on its card's models where its card names any, else on this chat's model";
    // The workers with a model of their own, which no list comes before: a seat's, or — the team naming no models — a
    // card's. Named with it, after what the others run on; one kind of worker, its model alone.
    const owned = ownModels(members, !models.length);
    const each = owned.map((x) => `${x.name} on ${prettyModel(x.model)}`).join(", ");
    const rest = models.length ? [mk("b", {}, models.join(", then ")), " · the team's"]
      : seats[0] ? [mk("b", {}, prettyModel(seats[0])), " · this chat's list"]
        : leadOn ? [mk("b", {}, prettyModel(leadOn)), " · its lead's"] : [mk("b", {}, "its lead's model")];
    const workers = !owned.length ? rest
      : owned.length < members.length ? [...rest, " — ", mk("b", {}, each)]
        : members.length === 1 ? [mk("b", {}, prettyModel(owned[0].model)), owned[0].whose === "team" ? " · the team's for it" : " · its card's"]
          : [mk("b", {}, each)];
    const workersTip = `${models.length ? "Its workers run on the team's models, first choice first"
      : `Each worker runs on its card's models where its card names any, else on ${seats[0] ? "this chat's list" : "its lead's model"}`}${
      owned.some((x) => x.whose === "team") ? "; a worker the team names a model for runs on that one" : ""}`;
    return [
      mk("span", { title: leadTip }, "Lead: ", ...lead),
      mk("span", { title: workersTip }, `${who}: `, ...workers),
    ];
  };

  /** A team as a squad: its lead with a crown, a line to its workers. @param {any} t */
  const squad = (t) => {
    const members = Array.isArray(t.members) ? t.members : [];
    const builds = usualWay(t) === "charge";
    const party = members.length === 1
      ? [mk("span", { class: "th-mem" }, portrait(memberLook(members[0]), "s32"), members[0].name), mk("span", { class: "th-mul" }, "× as many as needed")]
      : members.slice(0, 5).map((/** @type {any} */ m) => mk("span", { class: "th-mem" }, portrait(memberLook(m), "s32"), m.name));
    return mk("section", { class: "th-sq", "data-team": t.key, "aria-label": `${t.name} team` },
      mk("div", { class: "th-sq-name" }, mk("span", { class: "th-sq-nm" }, t.name), mk("span", { class: "th-sp" }),
        mk("span", { class: `th-tag ${builds ? "is-ed" : "is-ro"}` }, glyph(builds ? "pencil" : "lock", "th-tag-ic"), builds ? "Changes files" : "Read-only")),
      t.line ? mk("div", { class: "th-sq-line" }, String(t.line).replace(/\.?$/, ".")) : null,
      mk("div", { class: "th-party" }, portrait(leadLook(t.key), "s48", { crown: true }), mk("span", { class: "th-link" }), ...party),
      mk("div", { class: "th-sq-foot" }, mk("span", { class: "th-on" }, ...onLines(t)), mk("span", { class: "th-sp" }),
        mk("button", { class: "th-brief", type: "button", title: `Open the ${possessive(t.name)} Brief: say what it is to do — nothing runs until you press Send`, onclick: () => io.brief({ team: t.key, way: usualWay(t) }) }, "Brief…")));
  };

  const own = () => mk("section", { class: "th-sq is-new" },
    mk("div", { class: "th-sq-name" }, mk("span", { class: "th-sq-nm is-soft" }, "Make your own team")),
    mk("div", { class: "th-sq-line" }, "Pick a lead and the kinds of worker it sends, each with a line of what this team asks of it."),
    mk("div", { class: "th-party" }, portrait({ icon: "plus", tone: "ghost" }, "s48"), mk("span", { class: "th-link is-faint" }),
      portrait({ icon: "plus", tone: "ghost" }, "s32"), portrait({ icon: "plus", tone: "ghost" }, "s32"), portrait({ icon: "plus", tone: "ghost" }, "s32")),
    mk("div", { class: "th-sq-foot" }, mk("span", { class: "th-on" }, "Or Duplicate any team and change it"), mk("span", { class: "th-sp" }),
      mk("button", { class: "th-brief", type: "button", onclick: () => io.newTeam() }, glyph("plus", "th-btn-ic"), "New team…")));

  const tip = () => mk("div", { class: "th-tip" },
    mk("div", { class: "th-tip-head" }, glyph("bot", "th-soft t-blue"), mk("b", {}, "Your agent can send one too")),
    mk("span", {}, "With its team tool, so its own context stays small. You see a card in the chat where it did, and its result comes to you first all the same."));

  /** @param {string} n @param {any[]} words */
  const rule = (n, ...words) => mk("div", {}, mk("span", { class: "th-num" }, n), mk("span", {}, ...words));

  /**
   * How teams work: the fold's line, which says the two ways so the fold need not be opened to choose one — each in
   * its diagram's own first words (`WAYS[way].short`). Pressed, it opens on the two diagrams or folds them, and how it
   * was left is kept for the person.
   * @param {any} chat
   */
  const how = (chat) => mk("button", {
    class: `th-how${open ? " is-open" : ""}`, type: "button", "data-key": "how", "aria-expanded": open ? "true" : "false",
    onclick: () => {
      open = !open;
      keep.set(HOW_PREF, open ? "1" : "0");
      key = "";
      paint(chat);
    },
  },
  glyph("columns2", "th-soft t-blue"),
  mk("span", { class: "th-how-text" },
    mk("b", { class: "th-how-name" }, "How teams work"),
    .../** @type {const} */ (["side", "charge"]).map((way) => mk("span", { class: `th-how-way is-${way}` }, mk("b", {}, WAYS[way].label), mk("span", {}, WAYS[way].short)))),
  glyph(open ? "chevronUp" : "chevronDown", "th-how-chev"));

  /** @param {any} chat */
  function paint(chat) {
    const teams = (io.teams() || []).filter((t) => t && t.key);
    const armed = io.armed?.() || null;
    const k = JSON.stringify([chat?.chainId, teams, io.model(), io.seats(), open, armed]);
    if (k === key) return;
    key = k;
    const model = io.model();
    drawIn(top, kids([
      mk("div", { class: "th-head" },
        mk("div", { class: "th-head-text" },
          mk("h2", { class: "th-h1" }, "Teams"),
          mk("span", { class: "th-sub" }, "A team is a ", mk("b", {}, "lead"), " ", glyph("crown", "th-crown-ic"), " who plans and checks, and ", mk("b", {}, "workers"), " who do the pieces — as many at once as the job needs.")),
        mk("span", { class: "th-sp" }),
        mk("span", { class: "th-who" }, portrait({ icon: "bot", tone: "agent" }, "s24"), "This chat is answered by ", mk("b", {}, "your agent"), model ? ` · ${prettyModel(model)}` : "")),
      armed ? mk("div", { class: "th-armed", role: "status" }, glyph("crown", "th-soft t-yellow"),
        mk("span", {}, mk("b", {}, `The ${possessive(armed.name)} lead takes over this chat`), " when the turn running now ends, with this chat open in this window — your words go to it as its first message."),
        io.disarm ? mk("button", { class: "th-brief", type: "button", onclick: () => io.disarm?.() }, "Cancel") : null) : null,
    ]));
    const g = groupsOf(teams);
    // The teams first; the lesson — the two ways, each with its picture — folded under them; the three rules at the foot.
    drawIn(roster, kids([
      mk("div", { class: "th-sec" },
        mk("div", { class: "th-sec-t" }, mk("b", {}, "Your teams"), mk("span", {}, "the crown is the lead; the others are the workers it sends")),
        mk("span", { class: "th-sp" }),
        mk("button", { class: "th-link-btn", type: "button", onclick: () => io.library() }, glyph("users", "th-btn-ic"), "Edit in Library")),
      mk("div", { class: "th-group" },
        mk("div", { class: "th-group-label" }, glyph("eye", "th-soft t-teal"), "They look and check", mk("span", {}, "· change no file · usually on the side")),
        mk("div", { class: "th-grid" }, ...g.look.map(squad), own(), tip())),
      g.build.length ? mk("div", { class: "th-group" },
        mk("div", { class: "th-group-label" }, glyph("hammer", "th-soft t-orange"), "They build", mk("span", {}, "· change files, each worker in its own copy · usually in charge")),
        mk("div", { class: "th-grid" }, ...g.build.map(squad))) : null,
      how(chat),
      open ? mk("div", { class: "th-ways", "data-key": "ways" }, wayCard("side", teams), wayCard("charge", teams)) : null,
      mk("div", { class: "th-rules", "data-key": "rules" },
        rule("1", mk("b", {}, "Nothing starts until you press Send."), " Brief… only opens the Brief: you see what the lead will read, on which models, before it costs anything."),
        rule("2", mk("b", {}, "Results come to you first."), " A team on the side reaches your agent only when you send it there — or when you switched that on as you sent the team."),
        rule("3", mk("b", {}, "Teams share each model's limit."), " A model runs as many agents at once as its limit, set on its row in Settings › Providers — with none set, as many as needed. A worker with no free slot waits and starts by itself.")),
    ]));
  }

  return { top, roster, paint };
}
