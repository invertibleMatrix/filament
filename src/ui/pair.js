// @ts-check
// The pairing page (the owner's remote Filament of 11-06, Part 1): where another machine's browser claims the code that
// Settings › Remote access, or `filament pair`, made on the machine Filament runs on. A link carries the code in its
// fragment, which no request sends: the page reads it and takes it off the address, says which machine it pairs with
// (/.well-known/filament), and claims it — POST /api/remote/claim, its Origin this page's — answered with an HttpOnly
// cookie the page never sees. Paired, it opens the harness. An unpaired browser that opens the harness lands here
// (front-door.js). Over https (Part 2, the network's listener) it asks the person to compare the browser's certificate
// details with the fingerprint the machine shows — the link carries it too. The words and the reading of the link are
// pure, for the tests.

/** The code a link's fragment carries (`#code=ABCD-EFGH`), or "". @param {string} hash */
export const codeOf = (hash) => String(new URLSearchParams(String(hash || "").replace(/^#/, "")).get("code") || "").trim();

/**
 * The certificate's fingerprint a link's fragment carries (`&fp=`, its 64 hex digits, from Settings › Remote access on
 * the machine itself), as browsers show one — `AB:CD:…` — or "" where it carries none that whole.
 * @param {string} hash
 */
export const printOf = (hash) => {
  const hex = String(new URLSearchParams(String(hash || "").replace(/^#/, "")).get("fp") || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
  return hex.length === 64 ? /** @type {string[]} */ (hex.match(/../g)).join(":") : "";
};

/**
 * What the page says of the certificate, over https (the network's listener, the owner's remote Filament of 11-06, Part
 * 2): the browser's own certificate details must show the fingerprint the machine itself shows — the link's, which came
 * from there, where it carries one. Over plain http (this machine, an SSH tunnel) no certificate is there to check: "".
 * The page is the server's, so it never vouches for its own certificate: the person compares what the browser shows.
 * @param {string} protocol @param {string} print @param {string} machine
 */
export function printWords(protocol, print, machine) {
  if (protocol !== "https:") return "";
  const where = "your browser's certificate details for this page (the warning sign or padlock in the address bar › Certificate) must show";
  return print
    ? `Check the certificate first: ${where} this SHA-256 fingerprint, which Settings › Remote access shows on ${machine} and the link carries. Another means something else answered: close the page.`
    : `Check the certificate first: ${where} the SHA-256 fingerprint Settings › Remote access shows on ${machine}. Another means something else answered: close the page.`;
}

/**
 * Whether this page came over plain http from another machine — the network's plain port, which reads in the clear:
 * a code typed here would go out for anyone on the way to read, so the page sends none (the review of p2-lan). This
 * machine's own address, and an SSH tunnel's (localhost), are no network.
 * @param {{ protocol?: string, hostname?: string }} loc
 */
export function inTheClear(loc) {
  if (String(loc?.protocol || "") !== "http:") return false;
  const host = String(loc?.hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return !(host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || host === "::1");
}

/** What the page says instead of a form, in the clear (`inTheClear`). @param {string} machine */
export const clearWords = (machine) =>
  `This page came over plain http, which anyone on the network can read: a code typed here would be theirs too. On ${machine}, turn on Settings › Remote access › Reach this machine on my network, and open the https address it shows — or its link.`;

/**
 * A device's name from its browser — "Chrome on macOS", say — which the person may change before pairing.
 * @param {string} ua
 */
export function deviceName(ua) {
  const s = String(ua || "");
  const browser = /Edg\//.test(s) ? "Edge" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "A browser";
  const os = /iPhone|iPad/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/**
 * What a refused claim says to the person: a wrong or spent code, too many wrong ones (with when to try again), or the
 * server's own words.
 * @param {number} status @param {any} body @param {string} machine @param {number} [now]
 */
export function claimWords(status, body, machine, now = Date.now()) {
  if (status === 429) {
    const s = body?.retryAt ? Math.max(1, Math.ceil((Number(body.retryAt) - now) / 1000)) : 60;
    return `Too many wrong codes: try again in ${s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`}.`;
  }
  if (status === 403 && body?.https) return clearWords(machine);
  if (status === 403) return `That code is wrong or has run out. Make a new one on ${machine} (Settings › Remote access) and type it here.`;
  return `Not paired: ${body?.error || `HTTP ${status}`}`;
}

/**
 * The name a browser here is paired at, as `filament open`'s link or the tray's carries it (`&name=filament-<12 hex>`,
 * services/machine.js `pageHost`): `<it>.localhost`, or "" for none or any other.
 * @param {string} hash
 */
export const pageNameOf = (hash) => {
  const n = String(new URLSearchParams(String(hash || "").replace(/^#/, "")).get("name") || "").toLowerCase();
  return /^filament-[0-9a-f]{12}$/.test(n) ? `${n}.localhost` : "";
};

/**
 * Where a browser here's link goes before it claims (the hunt on s0f): this page at the name it is paired at, on this
 * page's port, its fragment kept — so its cookie is that name's alone, never 127.0.0.1's, sent to every port there. The
 * link lands here first, at 127.0.0.1, which every browser opens: one that cannot open a name under localhost (Safari)
 * is told so (`NO_NAME_WORDS`) rather than left at its own error page. Null where the page stays: no name, or there.
 * @param {{ protocol?: string, hostname?: string, port?: string, pathname?: string, hash?: string }} loc
 */
export function pageMove(loc) {
  const name = pageNameOf(String(loc?.hash || ""));
  if (!name || String(loc?.protocol || "") !== "http:" || String(loc?.hostname || "").toLowerCase() === name) return null;
  return `http://${name}${loc.port ? `:${loc.port}` : ""}${loc.pathname || "/ui/pair.html"}${loc.hash}`;
}

/** What a browser that cannot open this Filament's own name is told: its pairing would hold a cookie every server here reads. @param {string} machine */
export const NO_NAME_WORDS = (machine) =>
  `This browser cannot open ${machine}'s own name for Filament (a name under localhost), where its sign-in is kept from every other server on this computer — Safari cannot. Open this link in Chrome, Firefox or Edge, or use the Filament app.`;

/** How long the page waits to learn whether the browser opens the name. */
const NAME_LOOK_MS = 3000;
/** What the page looks for at the name: Filament's own picture, which no browser blocks as Firefox may /health's JSON read with no-cors. */
export const LOOK_PATH = "/ui/filament-icon.png";

/**
 * Whether the browser opens an address — the name a browser here is paired at (`pageMove`) — by a picture loaded from
 * it, within `NAME_LOOK_MS`: a name it cannot open (Safari's under localhost) fails, or never answers. A clock of its
 * own, for browsers with no `AbortSignal.timeout` (Safari before 16). @param {string} url
 * @returns {Promise<boolean>}
 */
export const opensAt = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    const done = (/** @type {boolean} */ ok) => {
      clearTimeout(clock);
      img.onload = img.onerror = null;
      resolve(ok);
    };
    const clock = setTimeout(() => done(false), NAME_LOOK_MS);
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
  });

/** Where a paired browser goes: the harness. */
export const HARNESS = "/ui/harness.html";

/**
 * Where a link sends the browser once paired (`&to=console`: the console, `filament open console`'s; `&to=/<page>`: that
 * page of this Filament's, as `npm run app -- -Page` names one), else the harness. A page is a path at this page's own
 * address alone: never `//host`, a backslash (which a browser reads as a slash) or a scheme.
 * @param {string} hash
 */
export const goesTo = (hash) => {
  const to = String(new URLSearchParams(String(hash || "").replace(/^#/, "")).get("to") || "");
  return to === "console" ? "/" : /^\/(?![/\\])[^\s\\]*$/.test(to) ? to : HARNESS;
};

/**
 * The page's behaviour over its elements (pair.html).
 * @param {{ doc?: Document, fetchImpl?: typeof fetch, loc?: Location, hist?: History, ua?: string, win?: { addEventListener: (type: string, fn: () => void) => void }, opens?: (url: string) => Promise<boolean> }} [o]
 *   `loc.replace`: a browser here's link moved to its name (`pageMove`)
 *   `win`: where a link opened on this page already says its new code (hashchange)
 *   `opens`: whether the browser opens an address (`opensAt`)
 */
export async function mountPair({ doc = document, fetchImpl = fetch, loc = location, hist = history, ua = navigator.userAgent, win = window, opens = opensAt } = {}) {
  const $ = (/** @type {string} */ id) => /** @type {any} */ (doc.getElementById(id));
  const form = $("pair-form");
  const codeIn = $("pair-code");
  const nameIn = $("pair-name");
  const go = $("pair-go");
  const open = $("pair-open");
  const said = $("pair-said");
  const say = (/** @type {string} */ text, err = false) => {
    said.textContent = text;
    said.classList.toggle("is-err", err);
  };
  /** The fingerprint the last link carried, to compare with the browser's own certificate details. */
  let print = "";
  /** Where the browser goes once paired, as the link said. */
  let then = HARNESS;
  /** The address with no fragment: what a link's code and name leave. */
  const bare = () => hist.replaceState(null, "", loc.pathname + loc.search);
  // The code off the address at once: it stays in no history, no bookmark, no screen share. A link opened on this page
  // already changes its fragment alone, and is read the same way.
  const takeLink = () => {
    const code = codeOf(loc.hash);
    print = printOf(loc.hash) || print;
    if (code) then = goesTo(loc.hash);
    if (loc.hash) bare();
    if (code) codeIn.value = code;
    return code;
  };
  let machine = "that machine";
  /** What to compare the certificate with, over https: the words, and the link's fingerprint where it carried one. */
  const showPrint = () => {
    const words = printWords(String(loc.protocol || ""), print, machine);
    $("pair-print").hidden = !words;
    $("pair-print-words").textContent = words;
    $("pair-print-fp").textContent = words && print ? print : "";
    $("pair-print-fp").hidden = !(words && print);
  };
  /** The browser cannot open this Filament's name: no code is claimed on this page, a link opened on it later neither. */
  let nameless = false;
  // A browser here's link: on to the name it is paired at, where the browser opens it — a picture of Filament's own
  // there, which a name the browser cannot open fails —; else the words, the code off the address, none claimed here.
  /** @param {string} move  where `pageMove` sends it */
  const moveOn = async (move) => {
    if (await opens(new URL(`${LOOK_PATH}?look=${Date.now()}`, move).href)) return void loc.replace(move);
    bare();
    form.hidden = true;
    nameless = true;
    let named = "this computer";
    try {
      named = String((await (await fetchImpl("/.well-known/filament")).json())?.name || named);
    } catch {}
    say(NO_NAME_WORDS(named), true);
  };
  // (the hunt on x38) A link opened on this page — at 127.0.0.1, where an earlier one landed — moves on as one opened
  // afresh; on a page the browser could not move, its code comes off the address and is claimed nowhere.
  win.addEventListener("hashchange", () => {
    const move = pageMove(loc);
    if (nameless) return void (loc.hash && bare());
    if (move) return void moveOn(move);
    if (!takeLink()) return;
    showPrint();
    nameIn.focus?.();
  });
  const move = pageMove(loc);
  if (move) return moveOn(move);
  // A browser here's link at the name it pairs at (`pageMove` brought it): its code is claimed at once, whoever the
  // browser is so far — under `server.loopbackTrust` "token" this computer's browser is no one's until it pairs.
  const hereLink = !!pageNameOf(loc.hash) && String(loc.hostname || "").toLowerCase() === pageNameOf(loc.hash);
  const fromLink = takeLink();
  nameIn.value = deviceName(ua);
  open.onclick = () => loc.assign(then);
  try {
    const who = await (await fetchImpl("/.well-known/filament")).json();
    machine = String(who?.name || machine);
    $("pair-machine").textContent = machine;
    doc.title = `Pair with ${machine} — Filament`;
  } catch {}
  /** The code claimed — POST /api/remote/claim, answered with the HttpOnly cookie — and Filament opened; the words where not. @param {string} code */
  const claim = async (code) => {
    go.disabled = true;
    say("Pairing…");
    try {
      const r = await fetchImpl("/api/remote/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: String(nameIn.value || "").trim() }) });
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        go.disabled = false;
        return say(claimWords(r.status, body, machine), true);
      }
      say(`Paired as ${body?.device?.name || "this device"}: opening Filament…`);
      loc.assign(then);
    } catch (/** @type {any} */ err) {
      go.disabled = false;
      say(`Not paired: ${err?.message || err}`, true);
    }
  };
  // Paired already, or this machine itself: nothing to claim. A paired browser sent here — a link from another site
  // carries no SameSite=Strict cookie, so the harness did not know it — goes on to Filament (the review of 35049d31f).
  try {
    const r = await fetchImpl("/api/remote/me");
    if (r.ok) {
      const me = await r.json();
      // This machine's own browser — or an SSH tunnel's — at a link `filament open` or the app's Open in browser made
      // here: the code is this Filament's own, claimed at once, its pairing naming this browser in its old one's place.
      if (me?.who === "local" && fromLink) {
        $("pair-lead").textContent = `Pairing this browser with ${machine}…`;
        return claim(fromLink);
      }
      form.hidden = true;
      open.hidden = false;
      if (me?.who === "device") {
        $("pair-lead").textContent = `This browser is paired with ${machine} as ${me.device?.name}: opening Filament…`;
        loc.assign(then);
      } else if (me?.who === "tailnet") {
        // Your own tailnet login, where this machine trusts it (Settings › Remote access › Share on my tailnet).
        $("pair-lead").textContent = `This browser is signed in to Tailscale as ${me.login}, whom ${machine} trusts: opening Filament…`;
        loc.assign(then);
      } else $("pair-lead").textContent = `This is ${machine} itself: its Filament needs no pairing here.`;
      return;
    }
    // A device that went unused past its days is refused so, and how many it says (http/admin/index.js): this browser was
    // paired, and pairs again.
    const j = await r.json().catch(() => null);
    if (hereLink && fromLink) {
      $("pair-lead").textContent = `Pairing this browser with ${machine}…`;
      return claim(fromLink);
    }
    const unused = Number.isInteger(j?.days) && j.days > 0 ? `for ${j.days} days` : "too long";
    if (j?.lapsed === true)
      $("pair-lead").textContent = `This browser went unused on ${machine} ${unused}, so its pairing ran out. Type a new code from Settings › Remote access on that machine to pair it again.`;
  } catch {}
  if (inTheClear(loc)) {
    form.hidden = true;
    return say(clearWords(machine), true);
  }
  showPrint();
  (fromLink ? nameIn : codeIn).focus?.();
  form.onsubmit = async (/** @type {Event} */ e) => {
    e.preventDefault();
    const code = String(codeIn.value || "").trim();
    if (!code) return say("Type the code first.", true);
    await claim(code);
  };
}

if (typeof document !== "undefined" && document.getElementById("pair-form")) void mountPair();
