// @ts-check
// A stand-in for headless Chrome on its protocol pipe (`--remote-debugging-pipe`): it reads commands on fd 3 and writes
// answers and events on fd 4, each JSON ended by a NUL, as Chrome does, and quits when fd 3 closes. It answers the
// Target, Page, Accessibility, Runtime, DOM, Input, Emulation and Fetch commands the headless host and the driver send,
// over one made-up shop page: a heading, a Buy button (pressed, the heading says Bought), a Pricing link that opens a
// popup, and a Home link to Filament's own address (`FAKE_CHROME_OWN`, or the page's `?home=`). Every request a page
// makes passes the host's Fetch first, held until it is continued or failed, and a page's load again as its answer
// comes where the host asks it — a page's `?to=` a redirect there, to an app's address handed to the OS where it is let
// through; a page with `?mail` has a link to a mailto: address, asked for. A site on a `bad-cert.` host has a
// certificate no one vouches for: the host that overrides certificate errors is asked, else the page is Chrome's
// warning, whose link goes on. Each command it reads, and what its pages did, is written a line each to
// `FAKE_CHROME_LOG` where it is set.
import { appendFileSync, createReadStream, createWriteStream } from "node:fs";

const LOG = process.env.FAKE_CHROME_LOG || "";
const OWN = process.env.FAKE_CHROME_OWN || "http://127.0.0.1:20300/";
/** @param {string} line */
const note = (line) => {
  if (LOG) appendFileSync(LOG, `${line}\n`);
};
note(`argv ${JSON.stringify(process.argv.slice(2))}`);

const out = createWriteStream("", { fd: 4 });
const inp = createReadStream("", { fd: 3 });
/** @param {any} m */
const write = (m) => out.write(`${JSON.stringify(m)}\0`);
/** @param {string} method @param {any} params @param {string} [sessionId] */
const emit = (method, params, sessionId) => write({ method, params, ...(sessionId ? { sessionId } : {}) });

/**
 * @typedef {{ id: string, url: string, title: string, bought: boolean, session: string, width: number, height: number, home: string,
 *   certs: boolean, warning: boolean, pageOn?: boolean }} Target  `home`: where its Home link and its call home go; `certs`:
 *   the host overrides its certificate errors; `warning`: it shows Chrome's certificate warning; `pageOn`: Page.enable
 */
/** @type {Map<string, Target>} */
const targets = new Map();
/** @type {Map<string, string>} */
const sessions = new Map();
let ids = 0;
/** @param {string} url @returns {Target} */
const made = (url) => {
  const t = { id: `T${++ids}`, url, title: url === "about:blank" ? "" : "Shop", bought: false, session: "", width: 1280, height: 800, home: "", certs: false, warning: false };
  targets.set(t.id, t);
  return t;
};
made("about:blank");

/** Requests held at the host's Fetch, by their id: each resolved with what the host said of it. @type {Map<string, (v: string) => void>} */
const held = new Map();
let requests = 0;
/** A request the page makes, held until the host continues or fails it. @param {string} url @param {string} type @param {string} frameId */
const request = (url, type, frameId) =>
  new Promise((resolve) => {
    const requestId = `R${++requests}`;
    held.set(requestId, resolve);
    emit("Fetch.requestPaused", { requestId, request: { url, method: "GET" }, resourceType: type, frameId });
  });
/** Whether the host holds a page's load again as its answer comes (Fetch.enable's Document pattern at the Response stage). */
let holdsAnswers = false;
/**
 * A page's load answered — a redirect to the page's `?to=` where it has one —, held again where the host asks it: what
 * the host said of it. @param {string} url @param {string} frameId
 */
const answered = (url, frameId) => {
  const to = (URL.canParse(url) && new URL(url).searchParams.get("to")) || "";
  if (!holdsAnswers) return Promise.resolve("continue");
  return new Promise((resolve) => {
    const requestId = `R${++requests}`;
    held.set(requestId, resolve);
    const answer = to ? { responseStatusCode: 302, responseHeaders: [{ name: "Location", value: to }] } : { responseStatusCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html" }] };
    emit("Fetch.requestPaused", { requestId, request: { url, method: "GET" }, resourceType: "Document", frameId, ...answer });
  });
};

/** The page's accessibility tree: the shop, or Chrome's certificate warning. @param {Target} t */
const tree = (t) =>
  t.warning
    ? [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Privacy error" }, childIds: ["2", "3"] },
        { nodeId: "2", role: { value: "heading" }, name: { value: "Your connection is not private" }, properties: [{ name: "level", value: { value: 1 } }], childIds: [] },
        { nodeId: "3", role: { value: "link" }, name: { value: "Proceed to bad-cert.test (unsafe)" }, backendDOMNodeId: 9, childIds: [] },
      ]
    : shop(t);
/** The shop; a page with `?mail` has a Mail link too, to an address that is no web page's. @param {Target} t */
const shop = (t) => [
  { nodeId: "1", role: { value: "RootWebArea" }, name: { value: t.title }, childIds: ["2", "3", "4", "5", ...(mails(t) ? ["6"] : [])] },
  { nodeId: "2", role: { value: "heading" }, name: { value: t.bought ? "Bought" : "Welcome" }, properties: [{ name: "level", value: { value: 1 } }], childIds: [] },
  { nodeId: "3", role: { value: "button" }, name: { value: "Buy" }, backendDOMNodeId: 9, childIds: [] },
  { nodeId: "4", role: { value: "link" }, name: { value: "Pricing" }, backendDOMNodeId: 10, childIds: [] },
  { nodeId: "5", role: { value: "link" }, name: { value: "Home" }, backendDOMNodeId: 11, childIds: [] },
  ...(mails(t) ? [{ nodeId: "6", role: { value: "link" }, name: { value: "Mail us" }, backendDOMNodeId: 12, childIds: [] }] : []),
];
/** @param {Target} t */
const mails = (t) => URL.canParse(t.url) && new URL(t.url).searchParams.has("mail");
/** Each element's box: a row of 50 pixels, from the top. */
const ROWS = /** @type {Record<number, number>} */ ({ 9: 0, 10: 50, 11: 100, 12: 150 });
/** @param {number} y */
const elementAt = (y) => Number(Object.keys(ROWS).find((k) => y >= ROWS[Number(k)] && y < ROWS[Number(k)] + 50) || 0);

/** Certificate errors asked of the host, by their event's id: each resolved with what the host did. @type {Map<number, (v: string) => void>} */
const asked = new Map();
let certErrors = 0;
/** A certificate no one vouches for, asked of the host that overrides such errors. @param {Target} t @param {string} url */
const certificate = (t, url) =>
  new Promise((resolve) => {
    const eventId = ++certErrors;
    asked.set(eventId, resolve);
    emit("Security.certificateError", { eventId, errorType: "net::ERR_CERT_AUTHORITY_INVALID", requestURL: url }, t.session);
  });

/** A navigation of a tab's main frame, through the host's Fetch: its events, or the error it ended in. @param {Target} t @param {string} url */
async function go(t, url) {
  if (url !== "about:blank" && (await request(url, "Document", t.id)) !== "continue") return { frameId: t.id, loaderId: "L", errorText: "net::ERR_BLOCKED_BY_CLIENT" };
  if (url !== "about:blank") {
    const v = await answered(url, t.id);
    if (v !== "continue") return { frameId: t.id, loaderId: "L", errorText: "net::ERR_BLOCKED_BY_CLIENT" };
    // A redirect let through to an address that is no web page's: Chrome hands it to the app that takes it.
    const to = new URL(url).searchParams.get("to");
    if (to && !/^https?:/i.test(to)) {
      note(`handed to the OS ${to}`);
      return { frameId: t.id, loaderId: "L", errorText: "net::ERR_ABORTED" };
    }
  }
  const bad = url.startsWith("https://bad-cert.");
  if (bad && t.certs) {
    const v = await certificate(t, url);
    note(`certificate ${v}`);
    if (v !== "continue") return { frameId: t.id, loaderId: "L", errorText: "net::ERR_ABORTED" };
  }
  t.warning = bad && !t.certs;
  t.url = t.warning ? "chrome-error://chromewebdata/" : url;
  t.title = url === "about:blank" ? "" : t.warning ? "Privacy error" : "Shop";
  t.bought = false;
  t.home = (URL.canParse(url) && new URL(url).searchParams.get("home")) || "";
  setTimeout(() => {
    for (const [method, params] of /** @type {[string, any][]} */ ([
      ["Page.frameStartedLoading", { frameId: t.id }],
      ["Page.frameNavigated", { frame: { id: t.id, url: t.url } }],
      ["Page.loadEventFired", {}],
      ["Page.frameStoppedLoading", { frameId: t.id }],
    ]))
      emit(method, params, t.session);
    // A page that calls home asks Filament's own address for its keys: what the host said of it is in its console.
    if (url.includes("calls-home")) {
      const to = t.home || `${OWN}api/keys`;
      void request(to, "XHR", t.id).then((v) => {
        note(`own request ${v} ${to}`);
        emit("Runtime.consoleAPICalled", { type: v === "continue" ? "log" : "error", args: [{ type: "string", value: v === "continue" ? "reached Filament" : "Failed to fetch" }] }, t.session);
      });
    }
  }, 5);
  // Chrome's warning is committed, and the navigation said to have failed.
  return { frameId: t.id, loaderId: `L${requests}`, ...(t.warning ? { errorText: "net::ERR_CERT_AUTHORITY_INVALID" } : {}) };
}

/** A press let go on a tab's page. @param {Target} t @param {number} y */
async function press(t, y) {
  const el = elementAt(y);
  if (el === 9) t.bought = true;
  if (el === 10) {
    // Pricing opens a popup: a new page with its opener, whose own load waits at the host's Fetch.
    const p = made("");
    emit("Target.targetCreated", { targetInfo: { targetId: p.id, type: "page", url: "", attached: false, openerId: t.id } });
    const v = await request("https://shop.test/pricing", "Document", p.id);
    note(`popup load ${v}`);
  }
  if (el === 11) {
    const to = t.home || `${OWN}settings`;
    const v = await request(to, "Document", t.id);
    note(`home load ${v} ${to}`);
  }
  if (el === 12 && mails(t)) {
    // An address no request is made for: Chrome says the page asked for it (where Page is on), and hands it on.
    if (t.pageOn) emit("Page.frameRequestedNavigation", { frameId: t.id, reason: "anchorClick", url: "mailto:sales@shop.test", disposition: "currentTab" }, t.session);
    note("asked for mailto:sales@shop.test");
  }
}

/** @param {any} m */
async function answer(m) {
  const p = m.params || {};
  const t = m.sessionId ? targets.get(String(sessions.get(m.sessionId))) : null;
  switch (m.method) {
    case "Browser.getVersion":
      return { product: "FakeChrome/1.0", protocolVersion: "1.3" };
    case "Target.getTargets":
      return { targetInfos: [...targets.values()].map((x) => ({ targetId: x.id, type: "page", url: x.url, attached: !!x.session })) };
    case "Target.createTarget": {
      const n = made(String(p.url || "about:blank"));
      n.width = Number(p.width) || n.width;
      n.height = Number(p.height) || n.height;
      emit("Target.targetCreated", { targetInfo: { targetId: n.id, type: "page", url: n.url, attached: false } });
      return { targetId: n.id };
    }
    case "Target.attachToTarget": {
      const n = targets.get(String(p.targetId));
      if (!n) throw new Error("No target with given id found");
      n.session = `S${n.id}`;
      sessions.set(n.session, n.id);
      emit("Target.attachedToTarget", { sessionId: n.session, targetInfo: { targetId: n.id, type: "page", url: n.url, attached: true }, waitingForDebugger: false });
      return { sessionId: n.session };
    }
    case "Target.closeTarget": {
      const n = targets.get(String(p.targetId));
      if (!n) return { success: false };
      targets.delete(n.id);
      if (n.session) sessions.delete(n.session);
      emit("Target.targetDestroyed", { targetId: n.id });
      return { success: true };
    }
    case "Fetch.enable":
      holdsAnswers = (p.patterns || []).some((/** @type {any} */ x) => x.requestStage === "Response" && x.resourceType === "Document");
      return {};
    case "Fetch.continueRequest":
    case "Fetch.failRequest": {
      const done = held.get(String(p.requestId));
      held.delete(String(p.requestId));
      done?.(m.method === "Fetch.continueRequest" ? "continue" : `fail ${p.errorReason}`);
      return {};
    }
  }
  if (!m.sessionId) return {};
  if (!t) throw new Error("Session with given id not found");
  switch (m.method) {
    case "Page.getFrameTree":
      return { frameTree: { frame: { id: t.id, url: t.url } } };
    case "Page.navigate":
      return go(t, String(p.url));
    case "Security.setOverrideCertificateErrors":
      t.certs = p.override === true;
      return {};
    case "Page.enable":
      t.pageOn = true;
      return {};
    case "Security.handleCertificateError": {
      const done = asked.get(Number(p.eventId));
      asked.delete(Number(p.eventId));
      done?.(String(p.action));
      return {};
    }
    case "Emulation.setDeviceMetricsOverride":
      t.width = Number(p.width);
      t.height = Number(p.height);
      return {};
    case "Page.getLayoutMetrics": {
      const vp = { pageX: 0, pageY: 0, clientWidth: t.width, clientHeight: t.height };
      return { cssVisualViewport: vp, cssLayoutViewport: vp };
    }
    case "Runtime.evaluate": {
      const e = String(p.expression || "");
      if (e.includes("location.href")) return { result: { type: "object", value: [t.url, t.title, t.width, t.height] } };
      if (e.includes("devicePixelRatio")) return { result: { type: "number", value: 1 } };
      if (e.includes("innerText")) return { result: { type: "string", value: t.bought ? "Bought" : "Welcome" } };
      return { result: { type: "undefined" } };
    }
    case "Accessibility.getFullAXTree":
      return { nodes: tree(t) };
    case "DOM.getContentQuads": {
      const top = ROWS[Number(p.backendNodeId)];
      if (top === undefined) throw new Error("Could not compute content quads.");
      return { quads: [[10, top + 10, 110, top + 10, 110, top + 40, 10, top + 40]] };
    }
    case "Input.dispatchMouseEvent":
      if (p.type === "mouseReleased") void press(t, Number(p.y));
      return {};
    case "Page.captureScreenshot":
      // Not a picture: what it was asked, so a test reads how the host asked for it.
      return { data: Buffer.from(JSON.stringify({ shot: p, size: { width: t.width, height: t.height } })).toString("base64") };
  }
  return {};
}

let buf = "";
inp.on("data", (d) => {
  buf += String(d);
  for (let i = buf.indexOf("\0"); i >= 0; i = buf.indexOf("\0")) {
    const m = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    note(`${m.sessionId ? "S" : "B"} ${m.method} ${JSON.stringify(m.params || {})}`);
    Promise.resolve()
      .then(() => answer(m))
      .then(
        (result) => write({ id: m.id, result, ...(m.sessionId ? { sessionId: m.sessionId } : {}) }),
        (e) => write({ id: m.id, error: { code: -32000, message: String(e?.message || e) }, ...(m.sessionId ? { sessionId: m.sessionId } : {}) }),
      );
  }
});
inp.on("end", () => {
  note("pipe closed");
  process.exit(0);
});
inp.on("error", () => process.exit(1));
