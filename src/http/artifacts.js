// @ts-check
// An artifact's address (HarnessV4_Artifacts_Plan E18, AF-D2): the front door hands every request for a name under
// `art.localhost` here, before anything of Filament's is reached, whatever its path — so a page an agent wrote, served
// on its own origin, finds nothing of Filament's there: no API, no harness, no model endpoints (AFC-33, AFC-55). What it
// answers is the artifact's files alone: its page, with Filament's small script first, at `/`; each file beside it by
// its path; an old version under `/_filament/v/<n>/`, so its page's own paths reach its own files (`?v=<n>` leads
// there); Filament's look and small script at `/_filament/look.css` and `/_filament/page.js`; and the data its page keeps
// (step 5, AF-D7) under `/_filament/db/`, with each change to it said at `/_filament/changes`. A typed artifact — a Doc
// or a deck (step 6), a Dashboard or a Design (step 7) — is its content drawn by Filament's own page, whose files are at
// `/_filament/ui/`; a Dashboard that reads Filament's own numbers (AF-D12) asks for each at `/_filament/feeds/<name>`
// and hears which changed at `/_filament/feed-changes`, and no other address is answered them. Every answer carries
// the artifact's policy and sets no cookie. Only this machine is answered (AFC-56), as `/api` is without its token,
// and only the page's own origin writes its data (AFC-90). The network's artifacts address (`artifactsDoor`,
// `artifactsListener`, the owner's remote Filament of 11-06, Part 4) answers the devices paired with this machine too,
// every artifact on one https origin under its name's path, on a port of its own beside the network's listener.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { feedsOf } from "../core/artifact-content.js";
import { SQL_BODY_MAX } from "../core/app-sql.js";
import { sourceKept } from "../core/dashboard-sources.js";
import { same } from "../core/hash.js";
import {
  CONTENT_JSON,
  LOOK_MARK,
  MERMAID_MODULE,
  NETWORK_SANDBOX,
  OWN_PREFIX,
  OWN_UI,
  OWN_UI_FILES,
  PAGE_FILE,
  STILL_PATH,
  STILL_SANDBOX,
  TYPE_MODULES,
  TYPE_STYLE,
  artifactOfPath,
  artifactPath,
  artifactsOnNetwork,
  artifactPolicy,
  artifactTypeOf,
  isTextData,
  contentFileOf,
  deletedPage,
  drawsDiagram,
  harnessOrigins,
  isEditable,
  isTyped,
  lookSheet,
  mermaidInline,
  rootedUnder,
  runsItself,
  servedPage,
  typeAlone,
  typeServed,
  typeShell,
} from "../core/artifacts.js";
import { SHELF_AT, shelf, shelfPath } from "../services/shelf.js";
import { LOOK_TOKENS, NOT_COLORS, VISUAL_HUES } from "../core/visual-look.js";
import { PINNED_TEXT, PINS_FILE, WEB_DIR, isWebFile, pinnedText, pinsOf } from "../core/web-pins.js";
import { FILAMENT_MARK } from "../core/headers.js";
import { createLanListener, lanPortOf } from "../services/lan-tls.js";
import { tailnetDoor } from "../services/tailscale.js";
import { agentsDevice, callerAddress, endsWithDevice, hostNameOf, isLocalCaller, readBody, whoIs } from "./guards.js";

/** The names a chart's script reads as colors: every name of the look but the type's and the corners'. */
const COLOR_NAMES = Object.freeze([...Object.keys(LOOK_TOKENS).filter((n) => !NOT_COLORS.includes(n)), ...VISUAL_HUES.map((h) => `--${h}-fill`)]);
/** What `filament.db` says opened from a file (AFC-93). */
export const AWAY_WORDS = "This page keeps its data in Filament: open it at its address while Filament runs.";
/** …and where Filament did not answer. */
export const DOWN_WORDS = "Filament did not answer, and this page keeps its data there: open it while Filament runs.";
/** What `filament.ask` says in a page opened alone in a browser (AFC-23). */
export const ALONE_ASK_WORDS = "Open this page in Filament to ask its agent.";
/** What an App's button says pressed in a page opened alone in a browser. */
export const ALONE_ACT_WORDS = "Open this app in its project's Space in Filament to run its buttons.";
/** The header a page's own changes carry, so the page is not told of them again (AFC-92). */
export const PAGE_MARK = "x-filament-page";
/** What `filament.db` says in a Design's screen (AFC-137): a mockup keeps nothing. */
export const SCREEN_DATA_WORDS = "A design's screen keeps no data: it is a mockup, drawn alone.";
/** …and `filament.ask`. */
export const SCREEN_ASK_WORDS = "A design's screen does not ask the agent: it is a mockup, drawn alone.";

/**
 * Filament's small script (AF-D7, AF-D33), run once the look has loaded and ahead of the page's own code.
 * - The page's `<html>` carries the theme and the Motion (`data-theme`, `data-motion`): inside the harness, the
 *   harness's, from its frame's name as it loads and from its message when either changes (AFC-68); alone in a
 *   browser, the system's, followed as it changes. A card's still preview is marked `data-still` (AFC-113).
 * - Each color name holds a plain `rgb()` a canvas paints with (AFC-70), written in a style of its own that weighs
 *   nothing, so the page's own rules win (AFC-69).
 * - `filament.db` (AF-D7): the page's data on its own address — `collections()`, `list(c)`, `get(c, id)`, `set(c,
 *   record)`, `update(c, id, fields)`, `delete(c, id)`, each a promise — and `onChange(fn)`, told which collection
 *   changed elsewhere (AFC-92); its own changes are marked, so it is not told of them. Opened from a file, each fails
 *   in words (AFC-93).
 * - `filament.ask(words)` (AF-D8), and `sendPrompt`, as a visual has them: inside the harness the words go to the
 *   harness, which takes them only after a click in the page (AFC-23, AFC-40); alone in a browser the page says to open
 *   it in Filament.
 * - An App's (10-29): `source(name, { fresh })`, `refresh(name)` and `onSource(fn)`, its kept sources at the version its
 *   page is; `jobs()`, `job(id)` and `onJob(fn)`, its buttons' runs and what they say as they go; `act(action, key)`
 *   and `stop(id)`, asked of the harness as an ask is — its sheet runs a button, never the page.
 * - Inside the harness, it tells the harness it is here (AFC-74) and what failed in it — a script's error, a file that
 *   did not load, what the policy refused (AFC-25, AFC-8) — and opens a link to another site in a new browser tab,
 *   never in the frame (AFC-73). Alone in a browser it says nothing to anyone.
 * - A Design's screen (`screen`, AFC-137) runs it too, for its look and what fails in it, but for what a mockup has
 *   not: its data and its asks say so in words, and a link goes nowhere but to a site written whole, in a new tab.
 *   Its Esc tells the Design's page, which takes the person back to the canvas (AFC-136).
 * @param {boolean} screen
 */
const pageScript = (screen) => [
  "(function(){",
  "var d=document.documentElement,me=document.currentScript,framed=window.parent!==window;",
  // The path its artifact sits under on the network's artifacts address, where its data is; "" at its own address.
  'var base=me&&me.getAttribute&&me.getAttribute("data-base")||"";',
  // There each page is an origin of none (its answer's sandbox, fx-artifacts): what such an origin is refused — its
  // storage, its cookies — is kept in the page while it stands; and an address of its own from the top reaches its
  // artifact's, under its path, as at its own address.
  "if(base){",
  'var mem=function(){var m=new Map();return {get length(){return m.size},key:function(i){var k=Array.from(m.keys());return i>=0&&i<k.length?k[i]:null},',
  'getItem:function(k){k=String(k);return m.has(k)?m.get(k):null},setItem:function(k,v){m.set(String(k),String(v))},removeItem:function(k){m.delete(String(k))},clear:function(){m.clear()}}};',
  '["localStorage","sessionStorage"].forEach(function(n){try{window[n]}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(x){}}});',
  'try{document.cookie}catch(e){var jar={};try{Object.defineProperty(document,"cookie",{configurable:true,get:function(){return Object.keys(jar).map(function(k){return k+"="+jar[k]}).join("; ")},',
  'set:function(v){var p=String(v).split(";")[0],i=p.indexOf("=");if(i>0)jar[p.slice(0,i).trim()]=p.slice(i+1).trim()}})}catch(x){}}',
  // An address from the top: written so, written whole on this host, a URL's, a Request's.
  'var top=location.protocol+"//"+location.host;',
  'var under=function(u){if(typeof u==="string"){var s=u.charAt(1);if(u.charAt(0)==="/"&&s!=="/"&&s!=="\\\\")return u.indexOf(base+"/")!==0?base+u:u;',
  'return u.indexOf(top+"/")===0&&u.indexOf(top+base+"/")!==0?top+base+u.slice(top.length):u}',
  'if(typeof URL==="function"&&u instanceof URL&&u.host===location.host&&u.pathname.indexOf(base+"/")!==0){var c=new URL(u.href);c.pathname=base+c.pathname;return c}',
  'if(typeof Request==="function"&&u instanceof Request){var r=under(u.url);return r===u.url?u:new Request(r,u)}return u};',
  'var of=window.fetch;if(of)window.fetch=function(i,o){return of.call(this,under(i),o)};',
  'var XO=window.XMLHttpRequest&&window.XMLHttpRequest.prototype.open;if(XO)window.XMLHttpRequest.prototype.open=function(){var a=Array.prototype.slice.call(arguments);a[1]=under(a[1]);return XO.apply(this,a)};',
  'var ES=window.EventSource;if(ES){var E2=function(u,o){return new ES(under(u),o)};E2.prototype=ES.prototype;E2.CONNECTING=0;E2.OPEN=1;E2.CLOSED=2;window.EventSource=E2}',
  "}",
  'var dark=matchMedia("(prefers-color-scheme: dark)"),still=matchMedia("(prefers-reduced-motion: reduce)");',
  `var told=null,named=/^${LOOK_MARK}:(light|dark):(full|reduced|off)(:still)?$/.exec(framed?String(window.name||""):"");`,
  'if(named){told={theme:named[1],motion:named[2]};if(named[3])d.setAttribute("data-still","")}',
  `var colors=${JSON.stringify(COLOR_NAMES)};`,
  'var own=document.createElement("style");',
  "if(me&&me.parentNode)me.parentNode.insertBefore(own,me.nextSibling);else d.appendChild(own);",
  "var px=null;",
  'var plain=function(v){if(!px){var c=document.createElement("canvas");c.width=c.height=1;px=c.getContext("2d",{willReadFrequently:true})}if(!px)return null;',
  'px.fillStyle="#010203";px.fillStyle=v;if(px.fillStyle==="#010203"&&v.toLowerCase()!=="#010203")return null;',
  "px.clearRect(0,0,1,1);px.fillRect(0,0,1,1);var p=px.getImageData(0,0,1,1).data,a=+(p[3]/255).toFixed(3);",
  'return a===1?"rgb("+p[0]+", "+p[1]+", "+p[2]+")":"rgba("+p[0]+", "+p[1]+", "+p[2]+", "+a+")"};',
  "var mark=function(){",
  'd.setAttribute("data-theme",told?told.theme:dark.matches?"dark":"light");',
  'd.setAttribute("data-motion",told?told.motion:still.matches?"reduced":"full");',
  'own.textContent="";var cs=getComputedStyle(d),out=[];',
  'for(var i=0;i<colors.length;i++){var v=cs.getPropertyValue(colors[i]).trim(),c=v?plain(v):null;if(c)out.push(colors[i]+":"+c)}',
  'own.textContent=":where(:root){"+out.join(";")+"}"};',
  "mark();",
  'dark.addEventListener("change",function(){if(!told)mark()});still.addEventListener("change",function(){if(!told)mark()});',
  'var say=function(m){m.filament="artifact";try{parent.postMessage(m,"*")}catch(e){}};',
  `var away=${screen ? "true" : '!/^https?:$/.test(location.protocol)'},AWAY=${JSON.stringify(screen ? SCREEN_DATA_WORDS : AWAY_WORDS)},DOWN=${JSON.stringify(DOWN_WORDS)};`,
  "var mine=Math.random().toString(36).slice(2,10);",
  'var call=function(method,path,body){if(away)return Promise.reject(new Error(AWAY));',
  `var o={method:method,headers:{"${PAGE_MARK}":mine}};if(body!==undefined){o.headers["content-type"]="application/json";o.body=JSON.stringify(body)}`,
  `return fetch(base+"/${OWN_PREFIX}/db"+path,o).then(function(r){return r.json().then(null,function(){return {}}).then(function(j){`,
  'if(r.status===404&&j.missing)return j;if(!r.ok)throw new Error(j.error||("Filament answered "+r.status));return j})},function(){throw new Error(DOWN)})};',
  'var seg=function(x){return "/"+encodeURIComponent(String(x))};',
  "var follows=[],stream=null;",
  "var db=Object.freeze({",
  'collections:function(){return call("GET","").then(function(j){return j.collections})},',
  'list:function(c){return call("GET",seg(c)).then(function(j){return j.records})},',
  'get:function(c,id){return call("GET",seg(c)+seg(id)).then(function(j){return j.record||null})},',
  'set:function(c,r){return call("POST",seg(c),r).then(function(j){return j.record})},',
  'update:function(c,id,f){return call("PATCH",seg(c)+seg(id),f).then(function(j){return j.record})},',
  '"delete":function(c,id){return call("DELETE",seg(c)+seg(id)).then(function(j){return !!j.deleted})},',
  'onChange:function(fn){if(typeof fn!=="function"||away)return function(){};follows.push(fn);',
  `if(!stream){stream=new EventSource(base+"/${OWN_PREFIX}/changes");stream.onmessage=function(e){var n;try{n=JSON.parse(e.data)}catch(x){return}`,
  "if(!n||n.from===mine)return;follows.slice().forEach(function(f){try{f({collection:n.collection})}catch(x){setTimeout(function(){throw x})}})}}",
  "return function(){var i=follows.indexOf(fn);if(i>=0)follows.splice(i,1);if(!follows.length&&stream){stream.close();stream=null}}}",
  "});",
  'var note=function(w){var n=document.createElement("div");n.setAttribute("role","status");n.textContent=w;',
  'n.style.cssText="position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;max-width:calc(100% - 32px);padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--text);font:var(--ui-font-size)/1.4 var(--font);box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:default";',
  '(document.body||d).appendChild(n);n.addEventListener("click",function(){n.remove()});setTimeout(function(){n.remove()},6000)};',
  screen
    ? `var ask=function(words){if(String(words==null?"":words).trim())note(${JSON.stringify(SCREEN_ASK_WORDS)})};`
    : `var ask=function(words){var t=String(words==null?"":words);if(!t.trim())return;if(!framed){note(${JSON.stringify(ALONE_ASK_WORDS)});return}say({kind:"ask",text:t})};`,
  ...(screen
    ? ["window.filament=Object.freeze({db:db,ask:ask});window.sendPrompt=ask;"]
    : [
        // An App's sources and its buttons' runs (the owner's of 10-29): read on its own address, at the version its
        // page is; a button is only asked for, as an ask is — the harness's sheet runs it, after a click in the page.
        `var mineGet=function(path){if(away)return Promise.reject(new Error(AWAY));return fetch(base+"/${OWN_PREFIX}"+path).then(function(r){return r.json().then(null,function(){return {}}).then(function(j){`,
        'if(!r.ok){var x=new Error(j.error||("Filament answered "+r.status));if(j.off)x.off=j.off;throw x}return j})},function(){throw new Error(DOWN)})};',
        `var ver=/^\\/${OWN_PREFIX}\\/v\\/(\\d+)\\//.exec(String(location.pathname).slice(base.length));`,
        'var at=function(path,fresh){var q=[];if(ver)q.push("v="+ver[1]);if(fresh)q.push("fresh=1");return path+(q.length?"?"+q.join("&"):"")};',
        "var hear={};",
        'var listen=function(path,fn){if(typeof fn!=="function"||away)return function(){};var l=hear[path];',
        `if(!l){l=hear[path]={fns:[],es:new EventSource(base+"/${OWN_PREFIX}"+path)};l.es.onmessage=function(e){var n;try{n=JSON.parse(e.data)}catch(x){return}`,
        "l.fns.slice().forEach(function(f){try{f(n)}catch(x){setTimeout(function(){throw x})}})}}",
        "l.fns.push(fn);return function(){var i=l.fns.indexOf(fn);if(i>=0)l.fns.splice(i,1);if(!l.fns.length&&hear[path]===l){l.es.close();delete hear[path]}}};",
        `var act=function(action,key){var k=key&&typeof key==="object"?key.__key:key;if(!framed){note(${JSON.stringify(ALONE_ACT_WORDS)});return}say({kind:"act",action:String(action),key:String(k==null?"":k)})};`,
        'var stop=function(id){if(framed)say({kind:"stop",id:String(id==null?"":id)})};',
        // Its own SQLite database (10-29): one statement and its values, answered with its rows.
        `var sql=function(q,params){if(away)return Promise.reject(new Error(AWAY));return fetch(base+"/${OWN_PREFIX}/sql",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sql:String(q==null?"":q),params:params==null?null:params})}).then(function(r){return r.json().then(null,function(){return {}}).then(function(j){`,
        'if(!r.ok)throw new Error(j.error||("Filament answered "+r.status));return j})},function(){throw new Error(DOWN)})};',
        "window.filament=Object.freeze({db:db,ask:ask,",
        'source:function(s,o){return mineGet(at("/sources"+seg(s),!!(o&&o.fresh)))},',
        'refresh:function(s){return mineGet(at("/sources"+seg(s),true))},',
        'onSource:function(fn){return listen("/source-changes",fn)},',
        'jobs:function(){return mineGet("/jobs").then(function(j){return j.jobs})},',
        'job:function(id){return mineGet("/jobs"+seg(id)).then(function(j){return j.job})},',
        'onJob:function(fn){return listen("/job-changes",fn)},',
        "act:act,stop:stop,sql:sql});window.sendPrompt=ask;",
      ]),
  "if(!framed)return;",
  'addEventListener("message",function(e){var m=e.data;if(e.source!==parent||!m||m.filament!=="look")return;',
  'if((m.theme!=="light"&&m.theme!=="dark")||(m.motion!=="full"&&m.motion!=="reduced"&&m.motion!=="off"))return;',
  "told={theme:m.theme,motion:m.motion};mark()});",
  'say({kind:"here"});',
  ...(screen ? ['addEventListener("keydown",function(e){if(e.key==="Escape")say({kind:"escape"})});'] : []),
  'addEventListener("error",function(e){var t=e.target;if(t&&t!==window&&(t.src||t.href)){var u=t.src||t.href;say({kind:"fail",what:"load",url:String(typeof u==="object"?u.baseVal:u)});return}',
  'var f=String(e.filename||""),w=String(e.message||"Script error.");if(/^ResizeObserver loop/.test(w))return;',
  'say({kind:"fail",what:"error",message:w,line:e.lineno|0,url:f===location.href?"":f})},true);',
  'addEventListener("unhandledrejection",function(e){var r=e.reason;say({kind:"fail",what:"error",message:String(r&&r.message?r.message:r)})});',
  'document.addEventListener("securitypolicyviolation",function(e){say({kind:"fail",what:"blocked",url:String(e.blockedURI||""),directive:String(e.effectiveDirective||"")})});',
  'document.addEventListener("click",function(e){if(e.defaultPrevented)return;var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;',
  ...(screen
    ? ['var h=String(a.getAttribute("href")||"");if(h.charAt(0)==="#")return;e.preventDefault();if(/^https?:\\/\\//i.test(h))window.open(h,"_blank","noopener,noreferrer")});']
    : [
        'var h=a.href;if(h&&typeof h==="object")h=h.baseVal;var u;try{u=new URL(String(h||""),location.href)}catch(x){return}',
        // Its own address: an origin of none on the network's artifacts address, read there by its scheme and host.
        'var here=location.origin&&location.origin!=="null"?location.origin:location.protocol+"//"+location.host;',
        'if(u.origin===here||(u.protocol!=="http:"&&u.protocol!=="https:"))return;',
        'e.preventDefault();window.open(u.href,"_blank","noopener,noreferrer")});',
      ]),
  "})();",
].join("");
/** The script every page served from an artifact's address runs first. */
export const PAGE_SCRIPT_TEXT = pageScript(false);
/** …and each screen of a Design, which its page writes into the screen's frame. */
export const SCREEN_SCRIPT_TEXT = pageScript(true);

/** Where the harness's files are: its sheets, and Filament's own pages for its types. */
const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ui");
/** The harness's sheets that define its tokens, in the order its page loads them. */
export const TOKEN_SHEETS = Object.freeze(["harness.css", "harness/instruments.css", "harness/aqua.css"].map((f) => join(UI_DIR, f)));
/** The look as last made, by the times its sheets were last changed. @type {{ key: string, css: string } | null} */
let looked = null;
/** The look of the moment (AF-D32): made again only when one of the harness's sheets changed. */
export function lookCss() {
  const key = TOKEN_SHEETS.map((f) => statSync(f).mtimeMs).join("|");
  if (looked?.key !== key) looked = { key, css: lookSheet(TOKEN_SHEETS.map((f) => readFileSync(f, "utf8"))) };
  return looked.css;
}

/** Filament's own files for a type's page as last read, each by when it was last changed. @type {Map<string, { key: number, data: Buffer }>} */
const ownRead = new Map();
/**
 * One of Filament's own files for a type's page (`OWN_UI_FILES`, steps 6 and 7), read again only once it changed; null
 * for any other path.
 * @param {string} path  under `src/ui`
 */
export function ownUiFile(path) {
  if (!OWN_UI_FILES.includes(path)) return null;
  const file = join(UI_DIR, ...path.split("/"));
  const key = statSync(file).mtimeMs;
  const had = ownRead.get(path);
  if (had?.key === key) return had.data;
  const data = readFileSync(file);
  ownRead.set(path, { key, data });
  return data;
}

/** The shelf's files as last read, each by when it was last changed (10-29). @type {Map<string, { key: string, data: Buffer }>} */
const shelfRead = new Map();
/**
 * One of the shelf's files (`/_filament/lib/`, the Space Apps plan of 10-29), read again only once it changed, with the
 * tag a browser asks again by; null for any path the shelf does not list.
 * @param {string} path  under the shelf
 */
export function shelfFile(path) {
  const file = shelfPath(path);
  if (!file) return null;
  let st;
  try {
    st = statSync(file);
  } catch {
    return null;
  }
  const key = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
  const had = shelfRead.get(path);
  if (had?.key === key) return had;
  const it = { key, data: readFileSync(file) };
  shelfRead.set(path, it);
  return it;
}

/**
 * A version's file as its address serves it: a page, sheet or script of its own with each address it kept from the
 * web pointed at the file kept for it, in that version (vendor on publish, 10-29) — the file as written where it kept
 * none.
 * @param {import("../services/artifacts.js").ArtifactStore} store @param {string} name @param {number} v
 * @param {string} path @param {Buffer} data
 * @param {string} [base]  the path the artifact sits under on the network's artifacts address; "" at its own
 */
export function servedFile(store, name, v, path, data, base = "") {
  if (!PINNED_TEXT.test(path) || isWebFile(path) || !isTextData(data)) return data;
  const pins = pinsOf(store.file(name, v, PINS_FILE));
  if (!Object.keys(pins).length) return data;
  return Buffer.from(pinnedText(data.toString("utf8"), pins, (p) => `${base}/${OWN_PREFIX}/v/${v}/${WEB_DIR}/${p}`), "utf8");
}

/**
 * A type's sheet and code written inside its page, for a download that opens alone (AFC-118); the diagram library
 * too where a Doc's or a deck's Markdown draws a diagram.
 * @param {keyof typeof TYPE_MODULES} type @param {Record<string, unknown>} data  what its page draws (`typeData`)
 */
export function typeOwnAlone(type, data) {
  const text = (/** @type {string} */ p) => /** @type {Buffer} */ (ownUiFile(p)).toString("utf8");
  const diagram = typeof data.markdown === "string" && drawsDiagram(data.markdown);
  return typeAlone({ style: text(TYPE_STYLE), modules: TYPE_MODULES[type].map(text), mermaid: diagram ? mermaidInline(text(MERMAID_MODULE)) : null });
}

/**
 * What a typed artifact's page draws (AFC-106, AFC-122, AFC-135), from its content file at version `v`: a Doc's or a
 * deck's Markdown; a Dashboard's content and its version, by which its page asks its address for Filament's numbers
 * (AFC-129); a Design's content, with the look and the script each screen is drawn with (AFC-137) — written in, so its
 * download draws the same. Null where its content does not read as JSON.
 * @param {string} type @param {Buffer} file @param {number} v
 * @returns {Record<string, unknown> | null}
 */
export function typeData(type, file, v) {
  const text = file.toString("utf8");
  if (isEditable(type)) return { markdown: text };
  let content;
  try {
    content = JSON.parse(text);
  } catch {
    return null;
  }
  return type === "dashboard" ? { content, v } : { content, kit: { look: lookCss(), script: SCREEN_SCRIPT_TEXT } };
}

/** An old version's place on an artifact's address. */
const VERSION_AT = new RegExp(`^/${OWN_PREFIX}/v/(\\d+)(/.*)?$`);
/** The data's place: its collections, one collection, one record — each part as the address spells it. */
const DATA_AT = new RegExp(`^/${OWN_PREFIX}/db(?:/([^/]+)(?:/([^/]+))?)?/?$`);
/** Where each change to the data is said, as it is kept. */
const CHANGES_AT = `/${OWN_PREFIX}/changes`;
/** One of Filament's numbers, which a Dashboard that reads it asks for (AF-D12, AFC-129). */
const FEED_AT = new RegExp(`^/${OWN_PREFIX}/feeds/([^/]+)$`);
/** Where a Dashboard is told which of its numbers changed (AFC-131). */
const FEED_CHANGES_AT = `/${OWN_PREFIX}/feed-changes`;
/** One of a kept Dashboard's or App's sources, and where it is told one was read again (HarnessV4_Space_Plan SG-D8). */
const SOURCE_AT = new RegExp(`^/${OWN_PREFIX}/sources/([^/]+)$`);
const SOURCE_CHANGES_AT = `/${OWN_PREFIX}/source-changes`;
/** An App's buttons' runs, one with its log, and where it is told of each as it goes (`filament.jobs`). */
const JOBS_AT = new RegExp(`^/${OWN_PREFIX}/jobs(?:/([^/]+))?/?$`);
const JOB_CHANGES_AT = `/${OWN_PREFIX}/job-changes`;
/** An App's own SQLite database, one statement at a time (`filament.sql`). */
const SQL_AT = `/${OWN_PREFIX}/sql`;
/** How young a source's rows may be that its page's refresh reads again: a page that asks in a loop runs nothing more. */
export const FRESH_MS = 10_000;
/**
 * An app's pages ask a process of their own (the Space Apps plan of 10-29, measured on Electron 45): every app is under
 * art.localhost, one site, and without it one app's busy page stalled another app's frame for as long as it ran — with
 * it, not at all. Filament's own page, on 127.0.0.1, is apart either way. An artifact that is no app keeps the one
 * process of its site: the Artifacts page frames many at once, each its preview.
 */
export const APP_PAGE_HEAD = Object.freeze({ "origin-agent-cluster": "?1" });
/** Whether a value is a JSON object. @param {unknown} x */
const isObject = (x) => Object.prototype.toString.call(x) === "[object Object]";

/**
 * @param {{ store: import("../services/artifacts.js").ArtifactStore, server: () => any, port: () => number, feeds?: import("../services/artifact-feeds.js").Feeds | null,
 *   dashboards?: import("../services/dashboard-runner.js").DashboardRunner | null, sql?: import("../services/app-sql.js").AppSql | null }} deps
 *   `server`: the `server` config section, read per request; `port`: the port Filament listens on now; `feeds`:
 *   Filament's own numbers, which a Dashboard reads — where none are given, its tiles that read them say so;
 *   `dashboards`: what runs a Space's dashboards, which answers a kept Dashboard's sources (HarnessV4_Space_Plan S2);
 *   `sql`: each app's own SQLite database (10-29) — where none is given, an app has none
 * @returns {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, name: string, url: URL, o?: { still?: boolean, network?: { base: string, preview?: boolean } }) => void | Promise<void>}
 *   `still`: the request came to the artifact's still address, which the harness's previews frame — or from a page
 *   that reads alone (a view-only device's) —: its page reads its data, its database and its sources as they stand, and
 *   changes none of them; `network`: it came to the network's artifacts address, whose door let it in by its page's
 *   pass (`artifactsDoor`) and handed it on with `url` the path inside the artifact, which sits under `base` there, the
 *   pass in it — `preview`, a still preview's —: its page is an origin of none, and its pass alone says what it writes
 */
export function createArtifactsHandler({ store, server, port, feeds = null, dashboards = null, sql = null }) {
  const pageData = store.data;
  return function artifactAnswer(req, res, name, url, { still = false, network } = {}) {
    // Where the artifact sits on the address asked: "" at its own; its name's path on the network's artifacts address.
    const base = network?.base ?? "";
    // The page's own origin, which alone writes its data and runs its SQL: https on the network's artifacts address.
    const own = `${network ? "https" : "http"}://${String(req.headers.host || "").toLowerCase()}`;
    /** What an address that names no artifact is answered. */
    const nowhere = () => (network ? "No artifact has this address. An artifact's address here is /<name>/." : `No artifact has this address. An artifact's address is <name>.art.localhost:${port()}.`);
    const head = {
      "content-security-policy": artifactPolicy(harnessOrigins(port(), server(), network ? { host: String(hostNameOf(req) || "") } : null), network ? (network.preview ? STILL_SANDBOX : NETWORK_SANDBOX) : ""),
      "x-content-type-options": "nosniff",
      // On the network's artifacts address the page's own files are another origin's to it (its sandbox), let in by its
      // pass alone; its address, the pass in it, goes to its own address alone — a module it imports from the top is led
      // under its pass by it (`artifactsDoor`).
      "referrer-policy": network ? "same-origin" : "no-referrer",
      ...(network ? NETWORK_CORS : {}),
      "cache-control": "no-cache",
    };
    /** @param {number} status @param {string} type @param {string | Buffer} body @param {Record<string, string>} [more] */
    const send = (status, type, body, more = {}) => {
      const data = typeof body === "string" ? Buffer.from(body, "utf8") : body;
      res.writeHead(status, { ...head, ...more, "content-type": type, "content-length": String(data.length) });
      res.end(req.method === "HEAD" ? undefined : data);
    };
    /** @param {number} status @param {string} words */
    const say = (status, words) => send(status, "text/plain; charset=utf-8", `${words}\n`);
    /** @param {number} status @param {any} body @param {Record<string, string>} [more] */
    const json = (status, body, more = {}) => send(status, "application/json; charset=utf-8", JSON.stringify(body), { "cache-control": "no-store", ...more });

    /**
     * The page's data (AF-D7): GET its collections, a collection's records or one record; POST a record to a collection
     * (`set`); PATCH one record's fields (`update`); DELETE one. Only the page's own origin writes (AFC-90).
     * @param {string | undefined} rawC @param {string | undefined} rawId
     */
    const dataAnswer = async (rawC, rawId) => {
      let c, id;
      try {
        c = rawC === undefined ? undefined : decodeURIComponent(rawC);
        id = rawId === undefined ? undefined : decodeURIComponent(rawId);
      } catch {
        return json(400, { error: "That address does not read." });
      }
      if (!name) return json(404, { error: nowhere() });
      if (store.broken(name)) return json(500, { error: `The artifact ${name} could not be read from Filament's store.` });
      const method = String(req.method);
      const allowed = c === undefined ? ["GET", "HEAD"] : id === undefined ? ["GET", "HEAD", "POST"] : ["GET", "HEAD", "PATCH", "DELETE"];
      if (!allowed.includes(method)) return json(405, { error: `${method} is not taken here: ${allowed.join(", ")}.` }, { allow: allowed.join(", ") });
      /** @param {any} r @param {(r: any) => any} ok */
      const answer = (r, ok) => (r.ok ? json(200, ok(r)) : json(r.status, { error: `${r.error}.` }));
      if (method === "GET" || method === "HEAD") {
        if (c === undefined) return answer(pageData.collections(name), (r) => ({ collections: r.collections }));
        if (id === undefined) return answer(pageData.list(name, c), (r) => ({ collection: r.collection, records: r.records }));
        const r = pageData.get(name, c, id);
        if (r.ok && !r.record) return json(404, { error: `${c} has no record ${id}.`, missing: true });
        return answer(r, (x) => ({ record: x.record }));
      }
      // On the network's artifacts address every page is an origin of none: its pass, which says `still`, is the page's.
      if (!network && String(req.headers.origin || "").toLowerCase() !== own)
        return json(403, { error: "Only the artifact's own page writes its data." });
      if (still) return json(403, { error: "A still preview of the artifact writes nothing: open it to change its data." });
      const from = String(req.headers[PAGE_MARK] || "").slice(0, 40) || "page";
      if (method === "DELETE") return answer(pageData.change(name, c, { delete: [id] }, from), (r) => ({ deleted: r.done.deleted.length > 0 }));
      let body;
      try {
        body = JSON.parse(await readBody(req, server().maxBodyBytes));
      } catch (/** @type {any} */ e) {
        return e?.status === 413
          ? json(413, { error: `That is more than Filament takes in one request (server.maxBodyBytes).` })
          : json(400, { error: "The body is not JSON: give a JSON object." });
      }
      if (method === "POST") return answer(pageData.change(name, c, { set: [body] }, from), (r) => ({ record: r.done.set[0] }));
      return answer(pageData.change(name, c, { update: [isObject(body) ? { ...body, id } : body] }, from), (r) => ({ record: r.done.updated[0] }));
    };

    /** Each change to the page's data, said as it is kept (AFC-92): a stream the page opens when it follows. */
    const follow = () => {
      if (req.method !== "GET") return json(405, { error: "The changes are read by GET." }, { allow: "GET" });
      if (!name || !store.get(name)) return say(404, `No artifact is named ${name}.`);
      res.writeHead(200, { ...head, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
      res.write(": following\n\n");
      const stop = pageData.follow(name, (news) => res.write(`data: ${JSON.stringify(news)}\n\n`));
      req.on("close", stop);
    };

    /**
     * The Dashboard a request for its numbers comes from, at the version it names (`v`, its newest where none), and the
     * feeds that version reads — or why there is none, as the status and words to answer with. Only a Dashboard's own
     * page asks: any other artifact, and a feed its tiles do not name, is answered nothing (AFC-130).
     * @returns {{ status: number, error: string } | { a: import("../services/artifacts.js").Artifact, v: number, reads: string[] }}
     */
    const dashboardAt = () => {
      const a = name ? store.get(name) : null;
      if (!a || a.type !== "dashboard") return { status: 404, error: `${a ? a.title : "This address"} reads none of Filament's numbers.` };
      const newest = a.versions.length;
      const asked = url.searchParams.get("v");
      const v = asked == null ? newest : Number(asked);
      if (!Number.isInteger(v) || v < 1 || v > newest) return { status: 404, error: `${a.title} has no version ${asked}: it has 1 to ${newest}.` };
      let reads = [];
      try {
        reads = feedsOf(JSON.parse(String(store.file(a.name, v, CONTENT_JSON) || "")));
      } catch {
        return { status: 500, error: `v${v} of ${a.title} could not be read.` };
      }
      return { a, v, reads };
    };

    /** One feed's rows now, for a Dashboard whose tiles name it (AFC-129). @param {string} raw */
    const feedAnswer = (raw) => {
      if (req.method !== "GET" && req.method !== "HEAD") return json(405, { error: "Filament's numbers are read by GET." }, { allow: "GET, HEAD" });
      let feed;
      try {
        feed = decodeURIComponent(raw);
      } catch {
        return json(400, { error: "That address does not read." });
      }
      const d = dashboardAt();
      if (!("a" in d)) return json(d.status, { error: d.error });
      if (!d.reads.includes(feed)) return json(404, { error: `v${d.v} of ${d.a.title} does not read ${feed}.` });
      if (!feeds) return json(503, { error: "This Filament reads none of its numbers for a dashboard." });
      const r = feeds.read(feed, { days: url.searchParams.get("days") ?? undefined });
      return r.ok ? json(200, { feed, rows: r.rows, columns: r.columns, at: Date.now() }) : json(r.status, { error: `${r.error}.` });
    };

    /** Which of a Dashboard's numbers changed, as they change (AFC-131): a stream its page opens. */
    const followFeeds = () => {
      if (req.method !== "GET") return json(405, { error: "The changes are read by GET." }, { allow: "GET" });
      const d = dashboardAt();
      if (!("a" in d)) return json(d.status, { error: d.error });
      if (!d.reads.length || !feeds) return json(404, { error: `v${d.v} of ${d.a.title} reads none of Filament's numbers.` });
      res.writeHead(200, { ...head, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
      res.write(": following\n\n");
      const stop = feeds.follow((names) => {
        const mine = names.filter((n) => d.reads.includes(n));
        if (mine.length) res.write(`data: ${JSON.stringify({ feeds: mine })}\n\n`);
      });
      req.on("close", stop);
    };

    /**
     * One of a kept Dashboard's or App's sources (SG-D8): its rows as last read, read again when older than its every —
     * or than `FRESH_MS`, asked `fresh` — only for a version whose grant is the one kept; a draft's, and another
     * artifact's, are refused in words, with `off` (draft or paused) where it is not kept or paused, and `off` "held"
     * where a script it runs waits for a Keep.
     * @param {string} raw
     */
    const sourceAnswer = async (raw) => {
      if (req.method !== "GET" && req.method !== "HEAD") return json(405, { error: "A source is read by GET." }, { allow: "GET, HEAD" });
      let source;
      try {
        source = decodeURIComponent(raw);
      } catch {
        return json(400, { error: "That address does not read." });
      }
      const a = name ? store.get(name) : null;
      if (!a || !runsItself(a.type) || !dashboards) return json(404, { error: `${a ? a.title : "This address"} reads no source.` });
      const asked = url.searchParams.get("v");
      const v = asked == null ? a.versions.length : Number(asked);
      if (!Number.isInteger(v) || v < 1 || v > a.versions.length) return json(404, { error: `${a.title} has no version ${asked}: it has 1 to ${a.versions.length}.` });
      const may = dashboards.mayRead(name, v);
      if (!may.ok) return json(409, { error: `${a.title} does not read ${source} now: ${may.error}.`, off: may.off });
      // A still preview asks for no fresh read: what it shows is what the source holds.
      const r = await dashboards.read(name, v, source, url.searchParams.get("fresh") === "1" && !still ? { maxAge: FRESH_MS } : {});
      if (!r.ok) return json(409, { error: `${a.title} does not read ${source} now: ${r.error}.`, ...("off" in r && r.off ? { off: r.off } : {}) });
      const s = r.state;
      // `more`: a read that stopped at its most (a folder's), whose rows are of the first ones.
      return json(200, { source, rows: s.rows, at: s.at, error: s.error, errorAt: s.errorAt, fails: s.fails, stopped: s.stopped, ...(s.more ? { more: true } : {}) });
    };

    /** An App's buttons' runs (`filament.jobs`), or one with its log (`filament.job`). @param {string | undefined} raw */
    const jobsAnswer = (raw) => {
      if (req.method !== "GET" && req.method !== "HEAD") return json(405, { error: "Its runs are read by GET." }, { allow: "GET, HEAD" });
      const a = name ? store.get(name) : null;
      if (!a || !runsItself(a.type) || !dashboards) return json(404, { error: `${a ? a.title : "This address"} runs no button.` });
      if (raw === undefined) return json(200, { jobs: dashboards.jobsOf(name) });
      let id;
      try {
        id = decodeURIComponent(raw);
      } catch {
        return json(400, { error: "That address does not read." });
      }
      const job = dashboards.jobOf(name, id);
      return job ? json(200, { job }) : json(404, { error: `${a.title} has no run ${id}: it keeps its newest runs alone, across a restart too.` });
    };

    /** An App's buttons' runs as they start and end, and what each says as it comes: a stream its page opens. */
    const followJobs = () => {
      if (req.method !== "GET") return json(405, { error: "The changes are read by GET." }, { allow: "GET" });
      const a = name ? store.get(name) : null;
      if (!a || !runsItself(a.type) || !dashboards) return json(404, { error: `${a ? a.title : "This address"} runs no button.` });
      res.writeHead(200, { ...head, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
      res.write(": following\n\n");
      const stop = dashboards.followJobs((n, e) => {
        if (n === name) res.write(`data: ${JSON.stringify(e)}\n\n`);
      });
      req.on("close", stop);
    };

    /**
     * An App's own SQLite database (`filament.sql`, the Space Apps plan of 10-29): one statement, its values, from its
     * own page alone — drafts too, as its `filament.db` is the page's own — run in a process apart (services/app-sql.js).
     */
    const sqlAnswer = async () => {
      if (req.method !== "POST") return json(405, { error: "A statement is sent by POST: { sql, params }." }, { allow: "POST" });
      const a = name ? store.get(name) : null;
      const gone = !a && name ? store.deleted(name) : null;
      if (gone) return json(404, { error: `${gone.title} was deleted: it has no database now.` });
      if (!a || a.type !== "app" || !sql) return json(404, { error: `${a ? a.title : "This address"} has no database: an app has one.` });
      if (!network && String(req.headers.origin || "").toLowerCase() !== own)
        return json(403, { error: "Only the app's own page runs its SQL." });
      // Fifty of a page's statements may wait their turn: each is kept small, so what waits is.
      const most = Math.min(server().maxBodyBytes, SQL_BODY_MAX);
      let body;
      try {
        body = JSON.parse(await readBody(req, most));
      } catch (/** @type {any} */ e) {
        return e?.status === 413
          ? json(413, { error: `A statement and its values are ${most >= 1024 * 1024 ? `${Math.round(most / 1024 / 1024)} MB` : `${Math.round(most / 1024)} KB`} at most: send big data in several.` })
          : json(400, { error: "The body is not JSON: give { sql, params }." });
      }
      // An app deleted while its statement came in runs none: its database is being forgotten.
      if (store.get(name)?.type !== "app") return json(404, { error: "This app was deleted: it has no database now." });
      const r = await sql.run(name, body?.sql, body?.params, { readOnly: still });
      return r.ok ? json(200, { rows: r.rows, columns: r.columns, changes: r.changes, lastId: r.lastId, more: r.more }) : json(400, { error: r.error });
    };

    /** Which of a kept Dashboard's or App's sources were read again (SG-D8): a stream its page opens. */
    const followSources = () => {
      if (req.method !== "GET") return json(405, { error: "The changes are read by GET." }, { allow: "GET" });
      const a = name ? store.get(name) : null;
      if (!a || !runsItself(a.type) || !dashboards) return json(404, { error: `${a ? a.title : "This address"} reads no source.` });
      res.writeHead(200, { ...head, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
      res.write(": following\n\n");
      const stop = dashboards.follow((n, source) => {
        if (n === name) res.write(`data: ${JSON.stringify({ source })}\n\n`);
      });
      req.on("close", stop);
    };

    if (!network && !isLocalCaller(req)) return say(403, "An artifact answers only this machine.");
    const sourced = SOURCE_AT.exec(url.pathname);
    if (sourced) return sourceAnswer(sourced[1]);
    if (url.pathname === SOURCE_CHANGES_AT) return followSources();
    const ran = JOBS_AT.exec(url.pathname);
    if (ran) return jobsAnswer(ran[1]);
    if (url.pathname === JOB_CHANGES_AT) return followJobs();
    if (url.pathname === SQL_AT) return sqlAnswer();
    const kept = DATA_AT.exec(url.pathname);
    if (kept) return dataAnswer(kept[1], kept[2]);
    if (url.pathname === CHANGES_AT) return follow();
    const fed = FEED_AT.exec(url.pathname);
    if (fed) return feedAnswer(fed[1]);
    if (url.pathname === FEED_CHANGES_AT) return followFeeds();
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, "text/plain; charset=utf-8", "An artifact's address takes GET only, but for its data.\n", { allow: "GET, HEAD" });
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return say(400, "That address does not read.");
    }
    if (path === `/${OWN_PREFIX}/page.js`) return send(200, "text/javascript; charset=utf-8", PAGE_SCRIPT_TEXT);
    if (path === `/${OWN_PREFIX}/look.css`) return send(200, "text/css; charset=utf-8", lookCss());
    if (path.startsWith(OWN_UI)) {
      const own = ownUiFile(path.slice(OWN_UI.length));
      return own ? send(200, artifactTypeOf(path), own) : say(404, `Not found: ${path}`);
    }
    // The shelf (10-29): the libraries every page loads with no network, and at its top what it holds.
    if (path === SHELF_AT || `${path}/` === SHELF_AT)
      return json(200, { libraries: shelf().libraries.map((l) => ({ ...l, module: `${SHELF_AT}${l.module}`, ...(l.script ? { script: `${SHELF_AT}${l.script}` } : {}), ...(l.addons ? { addons: l.addons.map((x) => `${SHELF_AT}${x}`) } : {}) })) });
    if (path.startsWith(SHELF_AT)) {
      const lib = shelfFile(path.slice(SHELF_AT.length));
      if (!lib) return say(404, `The shelf holds no ${path.slice(SHELF_AT.length)}: ${SHELF_AT} lists what it holds.`);
      if (String(req.headers["if-none-match"] || "") === lib.key) {
        res.writeHead(304, { ...head, etag: lib.key });
        return void res.end();
      }
      return send(200, artifactTypeOf(path), lib.data, { etag: lib.key });
    }
    if (!name) return say(404, nowhere());
    if (store.broken(name)) return say(500, `The artifact ${name} could not be read from Filament's store.`);
    const a = store.get(name);
    if (!a) {
      const gone = store.deleted(name);
      return gone ? send(410, "text/html; charset=utf-8", deletedPage(gone.title, base)) : say(404, `No artifact is named ${name}.`);
    }
    const newest = a.versions.length;
    const asked = url.searchParams.get("v");
    if (asked != null && path === "/") {
      const n = Number(asked);
      if (!Number.isInteger(n) || n < 1 || n > newest) return say(404, `${a.title} has no version ${asked}: it has 1 to ${newest}.`);
      return send(302, "text/plain; charset=utf-8", "", { location: n === newest ? `${base}/` : `${base}/${OWN_PREFIX}/v/${n}/` });
    }
    const old = VERSION_AT.exec(path);
    let v = newest;
    let rest = path;
    if (old) {
      v = Number(old[1]);
      if (v < 1 || v > newest) return say(404, `${a.title} has no version ${old[1]}: it has 1 to ${newest}.`);
      if (!old[2]) return send(302, "text/plain; charset=utf-8", "", { location: `${base}${path}/` });
      rest = old[2];
    } else if ((rest === `/${OWN_PREFIX}` || rest.startsWith(`/${OWN_PREFIX}/`)) && !isWebFile(rest.slice(1))) return say(404, `Not found: ${path}`);
    // A typed artifact: its content, drawn by Filament's page of today, whatever version it is (AFC-106, AFC-119).
    if (isTyped(a.type) && (rest === "/" || rest === "")) {
      const keptAs = contentFileOf(a.type);
      const content = store.file(name, v, keptAs);
      const data = content ? typeData(a.type, content, v) : null;
      if (!data) return say(404, `v${v} of ${a.title} has no ${keptAs} that reads: its content could not be read.`);
      // A Dashboard's sources read only where this version is kept in a Space (SG-D7): its page reads them, each at its
      // every while it is seen, else it draws the rows the agent read, as a draft.
      if (a.type === "dashboard" && dashboards) {
        const may = dashboards.mayRead(name, v);
        data.space = may.ok
          ? { live: true, every: Object.fromEntries(Object.entries(may.content?.sources || {}).map(([s, raw]) => [s, sourceKept(raw).every])) }
          : { live: false, why: may.error, off: may.off };
      }
      // A still preview's, or a page that reads alone, is no view of it (the hunt of p4-artifacts).
      if (!old && !still && req.method === "GET") store.viewed(name);
      const type = /** @type {keyof typeof TYPE_MODULES} */ (a.type);
      return send(200, "text/html; charset=utf-8", servedPage(typeShell(type, a.title, data, typeServed(type, base)), a.title, base));
    }
    // What the version kept from the web is Filament's, under its own prefix, where no file of a publish may be.
    const file = rest === "/" || rest === "" ? PAGE_FILE : isWebFile(rest.slice(1)) ? rest.slice(1) : artifactPath(rest.slice(1));
    const at = typeof file === "string" ? file : file.ok ? file.path : null;
    const stored = at ? store.file(name, v, at) : null;
    const data = at && stored ? servedFile(store, name, v, at, stored, base) : null;
    // A browser's tab asks every address for its icon: a page that keeps none has nothing to say, which is no failure.
    if (!data && rest === "/favicon.ico") return send(204, "text/plain; charset=utf-8", "");
    if (!at || !data) return say(404, `Not found: ${path}`);
    const type = artifactTypeOf(at, data);
    // Its page opened, in the harness or a browser, is a view of it (AFC-14); an old version, as the grid's previews
    // load it, is not (AFC-81).
    if (!old && !still && path === "/" && req.method === "GET") store.viewed(name);
    // Every page of it draws in the harness's look and says what fails in it, its other pages as its first (AFC-75);
    // on the network's artifacts address its addresses from the top, and its sheets', are under its path there.
    if (type.startsWith("text/html")) return send(200, type, servedPage(rootedUnder(data.toString("utf8"), base, "html"), a.title, base), a.type === "app" ? APP_PAGE_HEAD : {});
    if (base && type.startsWith("text/css")) return send(200, type, rootedUnder(data.toString("utf8"), base, "css"));
    return send(200, type, data);
  };
}

/**
 * The port the network's artifacts address listens on (the owner's remote Filament of 11-06, Part 4): the one after the
 * network listener's (server.lan.port, as services/lan-tls.js `lanPortOf` reads it for both), which a tailnet's
 * `tailscale serve` serves too; any free one (0) where that is.
 * @param {{ port?: number } | undefined} lan  server.lan
 */
export function artifactsPort(lan) {
  const p = lanPortOf(lan);
  return p === 0 ? 0 : p + 1;
}

/** What a data write is answered for a view-only device. */
export const VIEW_WRITES_WORDS = "A view-only device reads an artifact: it changes none of its data.";
/** What a request whose pass is not good here is answered, but its page's own load, which the door gives a new one. */
export const PASS_WORDS = "This page's pass to its artifact is not good here, or has ended: load the page again.";
/** What a request for an artifact's file or data with no pass is answered, but its page's own load. */
export const NO_PASS_WORDS = "An artifact's files and data are read under the pass its page's address carries: open its page.";
/** How long a pass lasts: a page open longer is loaded again, and the door gives it another. */
export const PASS_MS = 12 * 60 * 60 * 1000;
/** What every answer on the network's artifacts address says to the page that asked, an origin of none there. */
const NETWORK_CORS = Object.freeze({ "access-control-allow-origin": "*" });

/**
 * The passes the network's artifacts address gives its pages (fx-artifacts): there one origin holds every artifact, so
 * each page is put in a sandbox that makes it an origin of none (`NETWORK_SANDBOX`), whose requests carry no cookie, and
 * reads its files and data under a pass in its path instead — `/<name>/~<pass>/…`, given as its page loads by a browser
 * the door lets in. A pass names its artifact, whether it is a still preview's, whether it writes (none for a still
 * preview or a view-only device), whom it was given — a device by its id, this machine, the admin token — and when it
 * ends; it is signed with a key this Filament keeps (`passKeyIn`), for the address it was given to: another artifact's
 * page cannot make one, nor read one, and one copied elsewhere is good nowhere else.
 * @param {{ key?: Buffer, now?: () => number, ms?: number }} [o]
 */
export function createPasses({ key = randomBytes(32), now = Date.now, ms = PASS_MS } = {}) {
  /** @param {string} body @param {string} from */
  const sign = (body, from) => createHmac("sha256", key).update(`${body}\n${from}`).digest("base64url").slice(0, 32);
  return {
    /** @param {{ name: string, still: boolean, writes: boolean, who: string, from: string }} p @returns {string} */
    give: ({ name, still, writes, who, from }) => {
      const body = Buffer.from(JSON.stringify([name, still ? 1 : 0, writes ? 1 : 0, who, now() + ms])).toString("base64url");
      return `${body}.${sign(body, from)}`;
    },
    /**
     * What a pass says, where it is good for `from` and has not ended; else null.
     * @param {string} pass @param {string} from @returns {{ name: string, still: boolean, writes: boolean, who: string } | null}
     */
    read: (pass, from) => {
      const [body = "", mac = ""] = String(pass).split(".");
      const want = sign(body, from);
      if (!body || !same(mac, want)) return null;
      try {
        const [name, still, writes, who, until] = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (typeof name !== "string" || typeof who !== "string" || !(Number(until) > now())) return null;
        return { name, still: still === 1, writes: writes === 1, who };
      } catch {
        return null;
      }
    },
  };
}

/** The file in the data folder that keeps the passes' key. */
export const PASS_KEY_FILE = "artifact-passes.key";
/**
 * The key the network's artifacts address signs its passes with, kept in the data folder (`PASS_KEY_FILE`): a page open
 * as Filament restarts reads on under its pass (the review of fx-artifacts). A folder that keeps none gives a key for
 * this run alone.
 * @param {string} dataDir @returns {Buffer}
 */
export function passKeyIn(dataDir) {
  const file = join(dataDir, PASS_KEY_FILE);
  try {
    const had = readFileSync(file);
    if (had.length === 32) return had;
  } catch {} // none yet: made below
  const key = randomBytes(32);
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, key, { mode: 0o600 });
  } catch {} // an unwritable folder: its passes end with this run
  return key;
}

/**
 * Whom a pass is given, as it names them: a device by its id, this machine, your own tailnet login by that login, the
 * admin token by a hash of the token it was — a token changed ends the passes the one before gave. @param {any} who
 * @param {any} server
 */
const passHolder = (who, server) =>
  who.kind === "device" ? String(who.device?.id) : who.kind === "local" ? "local" : who.kind === "tailnet" ? `${TAILNET_HOLDER}${who.login}` : `admin:${tokenMark(server?.adminToken)}`;
/** What a pass given to your own tailnet login names its holder by, before the login. */
const TAILNET_HOLDER = "tailnet:";
/** A short hash of an admin token, never the token. @param {unknown} token */
const tokenMark = (token) => createHash("sha256").update(String(token || "")).digest("base64url").slice(0, 16);
/** Whether a pass's holder is a device. @param {string} who */
const heldByDevice = (who) => who !== "local" && !who.startsWith("admin:") && !who.startsWith(TAILNET_HOLDER);

/** A page's own load — a frame's, a tab's — by a browser's word, or by a client's that says nothing of it. @param {import("node:http").IncomingMessage} req */
const loading = (req) => (req.method === "GET" || req.method === "HEAD") && (req.headers["sec-fetch-mode"] === undefined || req.headers["sec-fetch-mode"] === "navigate");

/**
 * The network's artifacts address (the owner's remote Filament of 11-06, Part 4): its every request, for the handler
 * `answer` (`createArtifactsHandler`). An artifact's page loads at `/<name>/` — `/<name>` is led there —, its still
 * preview at `/_still/<name>/`; for this machine and whom /api answers — the admin token, a paired device by the cookie
 * its browser holds for this machine's name, which goes to each of its ports — and for no one else, a page's own load
 * is led under a pass of its own (`createPasses`), and its every file and its data are read under it alone: one page
 * reaches no other artifact's data (fx-artifacts). A view-only device's pass writes nothing, and nothing it opens counts
 * as a view. A request with a pass not good here is refused, but a page's own load, which is led to its address with
 * none to be given another; one from the top of the address whose Referer — a module's import — carries a good pass is
 * led under it; a preflight is answered for any, as it reads nothing. Filament's own files that are no artifact's are
 * at the top, for whom it lets in. The cookie is HttpOnly and lets an artifact's page into nothing of Filament's: a
 * page here is an origin of none, which the admin API, the run socket and the terminal refuse as no origin of theirs,
 * and Filament's own address refuses a request whose Origin is this one (core/artifacts.js `isArtifactOrigin`).
 * @param {{ answer: ReturnType<typeof createArtifactsHandler>, server: () => any, devices?: import("../services/devices.js").DeviceStore | null,
 *   log?: (level: string, msg: string) => void, passes?: ReturnType<typeof createPasses> }} o  `server`: the `server` config section, read per request
 * @returns {(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<void>}
 */
export function artifactsDoor({ answer, server, devices = null, log = () => {}, passes = createPasses() }) {
  /**
   * Whom a pass was given, still let in: a device still paired and not revoked; this machine; the admin token it was
   * given under, while it is the token; your own tailnet login, while it is trusted. @param {string} who
   */
  const stillIn = (who) => {
    if (who === "local") return true;
    if (who.startsWith("admin:")) return !!server()?.adminToken && who === `admin:${tokenMark(server().adminToken)}`;
    // Your own tailnet login: while it is trusted, and Tailscale here is still signed in as it.
    if (who.startsWith(TAILNET_HOLDER)) return server()?.tailscale?.trustOwnLogin === true && !!tailnetDoor() && tailnetDoor()?.login === who.slice(TAILNET_HOLDER.length);
    const d = devices?.get(who);
    return !!d && d.revokedAt == null;
  };
  /**
   * A pass a path carries that is good for the caller: its artifact's, still preview or not, given to the caller's
   * address, to whom is still let in. @param {{ name: string, still: boolean, pass?: string } | null} at @param {string} from
   */
  const goodPass = (at, from) => {
    const p = at?.pass ? passes.read(at.pass, from) : null;
    return p && at && p.name === at.name && p.still === at.still && stillIn(p.who) ? p : null;
  };
  /** Where an artifact's page sits, with no pass. @param {{ name: string, still: boolean }} at */
  const prefixOf = (at) => (at.still ? `/${STILL_PATH}/${at.name}` : `/${at.name}`);
  return async function artifactsNetwork(req, res) {
    res.setHeader(FILAMENT_MARK, "1");
    /** @param {number} status @param {string} words @param {Record<string, string>} [more] */
    const say = (status, words, more = {}) => {
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store", ...NETWORK_CORS, ...more });
      res.end(req.method === "HEAD" ? undefined : `${words}\n`);
    };
    let url;
    try {
      url = new URL(req.url || "", "https://x");
    } catch {
      return say(400, "That address does not read.");
    }
    // A preflight asks what a page may send, and reads nothing: answered for any page, each an origin of none here, with
    // the headers it asks to send — a library's own (jQuery's X-Requested-With) as well as Filament's.
    if (req.method === "OPTIONS") {
      const asks = String(req.headers["access-control-request-headers"] || "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(s));
      const headers = [...new Set(["content-type", PAGE_MARK, ...asks])].slice(0, 32).join(", ");
      res.writeHead(204, { ...NETWORK_CORS, "access-control-allow-methods": "GET, HEAD, POST, PATCH, DELETE", "access-control-allow-headers": headers, "access-control-max-age": "600" });
      return void res.end();
    }
    const from = callerAddress(req);
    const at = artifactOfPath(url.pathname);
    try {
      if (at?.pass) {
        const p = goodPass(at, from);
        // Its page loaded again with a pass that ended, or is another's: led to its address with none, to be given one.
        if (!p) return loading(req) ? say(302, "", { location: `${prefixOf(at)}${at.rest || "/"}${url.search}` }) : say(403, PASS_WORDS);
        const base = `${prefixOf(at)}/~${at.pass}`;
        if (!at.rest) return say(302, "", { location: `${base}/${url.search}` });
        if (!p.writes && !p.still && DATA_AT.test(at.rest) && req.method !== "GET" && req.method !== "HEAD") return say(403, VIEW_WRITES_WORDS);
        // A device's page ends as the device does: what it follows closes at its revoke.
        if (heldByDevice(p.who)) res.on("close", endsWithDevice(devices, /** @type {any} */ ({ kind: "device", device: { id: p.who } }), () => res.destroy()));
        const inner = new URL(url.href);
        inner.pathname = at.rest;
        return await answer(req, res, at.name, inner, { still: p.still || !p.writes, network: { base, preview: p.still } });
      }
      // What a page's module imports from the top — `/_filament/lib/…`, `/app.js` — comes with no pass but the page's
      // address as its Referer: led under that page's pass, as at its own address the top is the artifact's.
      if (!loading(req)) {
        let ref = null;
        try {
          ref = new URL(String(req.headers.referer || ""));
        } catch {}
        // An address of IPv6 is named in brackets in a URL, and without them by `hostNameOf`.
        const by = ref && ref.hostname.replace(/^\[|\]$/g, "").toLowerCase() === hostNameOf(req) ? artifactOfPath(ref.pathname) : null;
        if (by?.pass && goodPass(by, from)) return say(307, "", { location: `${prefixOf(by)}/~${by.pass}${url.pathname}${url.search}` });
      }
      const who = whoIs(req, server(), devices);
      if (!who) return say(403, "An artifact answers this machine and the devices paired with it: pair this one from Filament's page here.");
      // Another machine's agents reach the rows their grants name (remote.js AGENT_ROUTES), and no artifact is one.
      if (agentsDevice(who)) return say(403, "Another machine's agents open no artifact here.");
      const view = who.kind === "device" && who.scope === "view";
      if (!at) {
        // Filament's own files that are no artifact's — its look, its small script, its types' pages, the shelf.
        if (url.pathname === `/${OWN_PREFIX}` || url.pathname.startsWith(`/${OWN_PREFIX}/`)) return await answer(req, res, "", url, { still: true, network: { base: "" } });
        return say(404, "No artifact has this address. An artifact's address here is /<name>/.");
      }
      if (!at.rest) return say(302, "", { location: `${prefixOf(at)}/${url.search}` });
      // Its page's own load, from this machine's own pages or the person's: led under a pass of its own. A page of
      // another site, or a sandboxed page here — another artifact's —, is given none.
      if (!loading(req) || req.headers["sec-fetch-site"] === "cross-site") return say(403, NO_PASS_WORDS);
      const pass = passes.give({ name: at.name, still: at.still, writes: !at.still && !view, who: passHolder(who, server()), from });
      return say(302, "", { location: `${prefixOf(at)}/~${pass}${at.rest}${url.search}` });
    } catch (/** @type {any} */ e) {
      log("error", `artifact ${at?.name || "(no name)"} on the network: ${req.method} ${url.pathname}: ${e?.stack || e}`);
      if (!res.headersSent) say(500, "The artifact could not be served.");
      else res.end();
    }
  };
}

/**
 * The network's artifacts address, listening (the owner's remote Filament of 11-06, Part 4): an https listener of its
 * own (services/lan-tls.js `createLanListener`) — on every address of this machine, with the certificate the network's
 * listener keeps, so the fingerprint a device pinned holds here too — at the port after the network listener's
 * (`artifactsPort`), on and off with it (server.lan). As it listens and stops it says its port to core/artifacts.js
 * (`artifactsOnNetwork`): Filament's pages may frame its origin, and Filament's own address refuses a request from it.
 * @param {{ dataDir: string, answer: ReturnType<typeof createArtifactsHandler>, server: () => any,
 *   devices?: import("../services/devices.js").DeviceStore | null, name?: () => string, log?: (level: string, msg: string) => void,
 *   nets?: () => NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>, host?: string }} o
 */
export function artifactsListener({ dataDir, answer, server, devices = null, name, log = () => {}, nets, host }) {
  const listener = createLanListener({
    dataDir,
    handler: artifactsDoor({ answer, server, devices, log, passes: createPasses({ key: passKeyIn(dataDir) }) }),
    // No socket answers on an artifact's address.
    upgrade: (_req, socket) => void socket.destroy(),
    ...(name ? { name } : {}),
    log: (level, msg) => log(level, msg.replace(/^remote: /, "remote: artifacts: ")),
    ...(nets ? { nets } : {}),
    ...(host ? { host } : {}),
    portOf: artifactsPort,
  });
  /** The port said to core/artifacts.js as the one it listens on, if any. @type {number | null} */
  let said = null;
  const tell = () => {
    const now = listener.state().listening?.port ?? null;
    if (now === said) return;
    if (said) artifactsOnNetwork(said, false);
    if (now) artifactsOnNetwork(now, true);
    said = now;
  };
  return {
    /** Listen as server.lan says: on with it, at the port after its. @param {{ enabled?: boolean, port?: number } | undefined} lan */
    apply: (lan) => listener.apply(lan).then(tell),
    state: listener.state,
    port: listener.port,
    settled: listener.settled,
    /** Its certificate read again, as the network's listener made a new key (admin/remote.js `/remote/lan/new-key`). */
    reload: () => listener.reload().then(tell),
    /** Off for good, as Filament stops. */
    close: () => listener.close().then(tell),
  };
}
