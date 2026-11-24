// Qoder cloud provider: talk to Qoder's chat service directly with your Qoder account (device login) or a
// personal access token, the way Qoder's own CLI does. Wire protocol reconstructed from the Qoder CLI as
// implemented by 9router: PKCE device login, "cosy" request signing, an obfuscated JSON body, and an SSE
// response whose lines wrap OpenAI-style chat chunks.
import {
  createHash,
  createCipheriv,
  publicEncrypt,
  constants as cryptoConstants,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { providerFetch, redirected, redirectRefusal } from "./fetch.js";
import { LINE_MAX, createLineReader } from "../../core/lines.js";
import { INCOMPLETE_STREAM } from "../../core/wire/errors.js";
// The old src/qoder.js path exported the catalogue; it lives in core now and stays reachable from here.
export { QODER_MODELS } from "../../core/catalogues.js";

export const QODER = {
  openApi: "https://openapi.qoder.sh",
  chatBase: "https://api3.qoder.sh", // device-login tokens
  chatBaseJob: "https://api2.qoder.sh", // job tokens (jt-…) obtained from a personal token
  loginUrl: "https://qoder.com/device/selectAccounts",
  devicePoll: "https://openapi.qoder.sh/api/v1/deviceToken/poll",
  userInfo: "https://openapi.qoder.sh/api/v1/userinfo",
  patExchange: "https://openapi.qoder.sh/api/v1/jobToken/exchange",
  quota: "https://openapi.qoder.sh/api/v2/quota/usage",
  chatPath: "/algo/api/v2/service/pro/sse/agent_chat_generation",
  modelsPath: "/algo/api/v2/model/list",
  cosyVersion: "1.0.0",
  clientType: "5",
  machineType: "5",
  machineOs: "x86_64_windows",
  dataPolicy: "disagree",
  loginVersion: "v2",
  publicKey: `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`,
};

// Two Qoder deployments exist: international (qoder.com, APIs on *.qoder.sh) and China (qoder.cn, APIs on
// *.qoder.com.cn). Host mapping taken from qodercli's own bundle, which selects China via QODERCLI_SITE=cn and
// there folds every api host (api1/api2/api3/center.qoder.sh) into gateway.qoder.com.cn.
export function qoderEndpoints(region) {
  if (region !== "china" && region !== "cn") {
    const q = QODER;
    return {
      openApi: q.openApi,
      chatBase: q.chatBase,
      chatBaseJob: q.chatBaseJob,
      loginUrl: q.loginUrl,
      devicePoll: q.devicePoll,
      userInfo: q.userInfo,
      patExchange: q.patExchange,
      quota: q.quota,
      clientId: "",
    };
  }
  const openApi = "https://openapi.qoder.com.cn",
    chat = "https://gateway.qoder.com.cn";
  // qoder.cn's device login requires the client_id the CN app itself sends (captured from a real qoder.cn
  // device-login URL); qoder.com accepts the request without one, which is how Filament has always logged in.
  return {
    openApi,
    chatBase: chat,
    chatBaseJob: chat,
    loginUrl: "https://qoder.cn/device/selectAccounts",
    devicePoll: `${openApi}/api/v1/deviceToken/poll`,
    userInfo: `${openApi}/api/v1/userinfo`,
    patExchange: `${openApi}/api/v1/jobToken/exchange`,
    quota: `${openApi}/api/v2/quota/usage`,
    clientId: "732aef47-9cf2-46a2-95fe-4cebb5d0d1fa",
  };
}

// A 403 code 101 "Signature invalid" from Qoder means the COSY envelope did not validate (wrong key, token or
// identity). Say it in words instead of a bare status, with the recovery paths that exist.
export const isSignatureRejection = (status, body) =>
  Number(status) === 403 && /signature invalid|"code"\s*:\s*"101"/i.test(String(body || ""));
export const signatureRejectionError = () =>
  Object.assign(
    new Error(
      "Qoder refused the signed request (403 \"Signature invalid\"): log out and back in on the upstream (the token may be stale for the account's region), or chat through a Qoder agent upstream (qoder/*, qoder-cn/*), which signs with Qoder's own CLI.",
    ),
    { code: "QODER_SIGNATURE" },
  );

// ---------------------------------------------------------------------------------------------------
// Body obfuscation: base64, rotate the string in thirds, then substitute the base64 alphabet.
// ---------------------------------------------------------------------------------------------------
const SUBST = (() => {
  const t = new Int16Array(128).fill(-1);
  const from = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const to = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";
  for (let i = 0; i < 64; i++) t[from.charCodeAt(i)] = to.charCodeAt(i);
  t[61] = 36; // "=" -> "$"
  return t;
})();
export function obfuscate(json) {
  const b64 = Buffer.from(typeof json === "string" ? json : JSON.stringify(json), "utf8").toString("base64");
  const n = b64.length,
    third = Math.floor(n / 3);
  const rotated = b64.slice(n - third) + b64.slice(third, n - third) + b64.slice(0, third);
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const c = rotated.charCodeAt(i);
    out[i] = c < 128 && SUBST[c] >= 0 ? SUBST[c] : c;
  }
  return out; // latin1 bytes; sent as the request body
}
// Inverse of obfuscate (tests, debugging of stored bodies). Accepts the latin1 string or the bytes.
export function deobfuscate(bytes) {
  const str = Buffer.isBuffer(bytes) ? bytes.toString("latin1") : String(bytes);
  const inv = new Map();
  for (let c = 0; c < 128; c++) if (SUBST[c] >= 0) inv.set(SUBST[c], c);
  let b64 = "";
  for (const ch of str) {
    const c = ch.charCodeAt(0);
    b64 += String.fromCharCode(inv.has(c) ? inv.get(c) : c);
  }
  const n = b64.length,
    third = Math.floor(n / 3),
    rest = n - 2 * third;
  // obfuscate emitted: last third (length `third`) + middle (length n - 2*third) + first third
  const last = b64.slice(0, third),
    middle = b64.slice(third, third + rest),
    first = b64.slice(third + rest);
  return Buffer.from(first + middle + last, "base64").toString("utf8");
}

// ---------------------------------------------------------------------------------------------------
// "cosy" signing headers
// ---------------------------------------------------------------------------------------------------
const md5 = (b) => createHash("md5").update(b).digest("hex");
function aesInfo(plain, key16) {
  const key = Buffer.from(key16, "utf8");
  if (key.length !== 16) throw new Error("aes key must be 16 bytes");
  const c = createCipheriv("aes-128-cbc", key, key.subarray(0, 16));
  c.setAutoPadding(false);
  const src = Buffer.from(plain, "utf8");
  const pad = 16 - (src.length % 16);
  const padded = Buffer.alloc(src.length + pad, pad);
  src.copy(padded, 0);
  return Buffer.concat([c.update(padded), c.final()]).toString("base64");
}
// Attachment budgets (same as Qoder's own clients): upload images up to 10 MB; if the upload fails keep data URIs
// inline only when small; never let the request body grow past 6 MB.
export const QODER_ATTACH = {
  uploadPath: "/algo/api/v2/image/upload",
  uploadCapBytes: 10 * 1024 * 1024,
  inlineCapBytes: 512 * 1024,
  bodyCapBytes: 6 * 1024 * 1024,
};
const uploadCache = new Map(); // sha256 of the bytes -> hosted url (an image pasted once is uploaded once per process)

// Upload one image to Qoder's image service; resolves to the hosted URL Qoder's models can fetch.
export async function uploadImage({ buffer, mediaType, creds, fetchImpl = fetch, signal }) {
  const requestId = randomUUID();
  const url = `${chatBase(creds)}${QODER_ATTACH.uploadPath}?request_id=${requestId}`;
  const ext = /png/i.test(mediaType)
    ? "png"
    : /jpe?g/i.test(mediaType)
      ? "jpg"
      : /gif/i.test(mediaType)
        ? "gif"
        : /webp/i.test(mediaType)
          ? "webp"
          : /bmp/i.test(mediaType)
            ? "bmp"
            : "bin";
  const boundary = `----filamentQoder${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.${ext}"\r\nContent-Type: ${mediaType || "application/octet-stream"}\r\n\r\n`,
  );
  const body = Buffer.concat([head, buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  // Qoder's own CLI signs uploads over the body LENGTH as a string, not the multipart bytes (signing the bytes gets
  // "Signature invalid"; that is why 9router's uploads always fell back to inline images).
  const headers = {
    ...cosyHeaders(String(body.length), url, {
      userId: creds.userId,
      authToken: creds.accessToken,
      name: creds.name,
      email: creds.email,
      machineId: creds.machineId,
    }),
    Accept: "application/json",
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": String(body.length),
    "AI-CLIENT-TIMESTAMP": String(Math.floor(Date.now() / 1000)),
    "Accept-Encoding": "identity",
  };
  const res = await fetchImpl(url, { method: "PUT", headers, body, signal });
  if (!res.ok)
    throw new Error(
      `upload HTTP ${res.status}${await res
        .text()
        .then((t) => (t ? ": " + t.slice(0, 160) : ""))
        .catch(() => "")}`,
    );
  const j = await res.json().catch(() => null);
  const find = (b) => {
    if (!b || typeof b !== "object") return null;
    const c = b.result && typeof b.result === "object" ? b.result : b;
    for (const arr of [c.imageUrls, c.image_urls, b.imageUrls, b.image_urls])
      if (Array.isArray(arr) && typeof arr[0] === "string" && arr[0]) return arr[0];
    for (const k of [
      "imageUrl",
      "image_url",
      "url",
      "ossUrl",
      "oss_url",
      "originalUrl",
      "originUrl",
      "link",
      "image",
    ]) {
      const v = c[k] ?? b[k];
      if (typeof v === "string" && v) return v;
    }
    if (typeof b.body === "string") {
      try {
        return find(JSON.parse(b.body));
      } catch {}
    }
    return null;
  };
  const hosted = find(j);
  if (!hosted) throw new Error("upload response carried no url");
  return hosted;
}

const dataUri = (u) => /^data:([^;]+);base64,(.+)$/s.exec(String(u || ""));
const b64Bytes = (b64) => Math.floor((String(b64 || "").replace(/\s/g, "").length * 3) / 4);
// Make every attachment in an OpenAI-shaped body deliverable to Qoder: inline images are uploaded and replaced by
// hosted URLs (kept inline when the upload fails and they are small); text files are inlined; other files are named.
export async function prepareAttachments(body, creds, { fetchImpl = fetch, signal, log = () => {} } = {}) {
  const notes = [];
  let uploaded = 0,
    kept = 0,
    stubbed = 0,
    inlined = 0,
    http = 0,
    cached = 0;
  const msgs = Array.isArray(body.messages)
    ? body.messages.map((m) => (m && Array.isArray(m.content) ? { ...m, content: [...m.content] } : m))
    : [];
  const stub = (name, mime, bytes, reason) => ({
    type: "text",
    text: `[The user attached ${name || mime || "a file"}${bytes ? ` (${Math.round(bytes / 1024)} KB)` : ""}, which could not be delivered to this model: ${reason}]`,
  });
  const image = async (b64, mime) => {
    const bytes = b64Bytes(b64);
    if (bytes > QODER_ATTACH.uploadCapBytes) {
      stubbed++;
      return stub("an image", mime, bytes, "larger than Qoder's 10 MB upload limit");
    }
    let buf;
    try {
      buf = Buffer.from(String(b64).replace(/\s/g, ""), "base64");
    } catch {
      stubbed++;
      return stub("an image", mime, bytes, "unreadable image data");
    }
    const key = createHash("sha256").update(buf).digest("hex");
    if (uploadCache.has(key)) {
      cached++;
      return { type: "image_url", image_url: { url: uploadCache.get(key) } };
    }
    try {
      const hosted = await uploadImage({
        buffer: buf,
        mediaType: mime || "image/png",
        creds,
        fetchImpl,
        signal,
      });
      if (uploadCache.size > 500) uploadCache.delete(uploadCache.keys().next().value);
      uploadCache.set(key, hosted);
      uploaded++;
      return { type: "image_url", image_url: { url: hosted } };
    } catch (e) {
      log("warn", `qoder image upload failed: ${e.message}`);
      if (bytes <= QODER_ATTACH.inlineCapBytes) {
        kept++;
        return { type: "image_url", image_url: { url: `data:${mime || "image/png"};base64,${b64}` } };
      }
      stubbed++;
      return stub("an image", mime, bytes, `upload failed (${e.message}) and it is too large to inline`);
    }
  };
  for (const m of msgs) {
    if (!m || !Array.isArray(m.content)) continue;
    for (let i = 0; i < m.content.length; i++) {
      const part = m.content[i];
      if (!part || typeof part !== "object") continue;
      if (part.type === "image_url") {
        const u = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
        const dm = dataUri(u);
        if (dm) m.content[i] = await image(dm[2], dm[1]);
        else if (/^https?:\/\//i.test(u || "")) {
          http++;
          m.content[i] = { type: "image_url", image_url: { url: u } };
        } else {
          stubbed++;
          m.content[i] = stub("an image", null, 0, "unreadable image reference");
        }
      } else if (part.type === "file" && part.file) {
        const name = part.file.filename || part.file.name || "a file";
        const dm = dataUri(part.file.file_data);
        const mime = dm?.[1] || part.file.format || "application/octet-stream";
        if (dm && /^image\//i.test(mime)) m.content[i] = await image(dm[2], mime);
        else if (dm && (/^text\//i.test(mime) || /json|xml|csv|markdown|yaml/i.test(mime))) {
          inlined++;
          m.content[i] = {
            type: "text",
            text: `--- Attached file: ${name} ---\n${Buffer.from(dm[2], "base64").toString("utf8")}\n--- end of ${name} ---`,
          };
        } else {
          stubbed++;
          m.content[i] = stub(
            `"${name}"`,
            mime,
            dm ? b64Bytes(dm[2]) : 0,
            "Qoder's chat models accept images and text, not binary documents; paste the text instead",
          );
        }
      }
    }
  }
  if (uploaded) notes.push(`qoder: ${uploaded} image(s) uploaded to Qoder and referenced by URL`);
  if (cached) notes.push(`qoder: ${cached} image(s) reused from an earlier upload`);
  if (kept) notes.push(`qoder: ${kept} image(s) sent inline (upload failed)`);
  if (http) notes.push(`qoder: ${http} image URL(s) passed through`);
  if (inlined) notes.push(`qoder: ${inlined} text file(s) inlined`);
  if (stubbed) notes.push(`qoder: ${stubbed} attachment(s) could not be delivered (see the message text)`);
  return { body: { ...body, messages: msgs }, notes, images: uploaded + cached + kept + http };
}

export function cosyHeaders(bodyBytes, url, { userId, authToken, name = "", email = "", machineId = "" }) {
  if (!userId) throw new Error("qoder: user id is empty (log in again)");
  if (!authToken) throw new Error("qoder: auth token is empty (log in again)");
  const body = Buffer.isBuffer(bodyBytes) ? bodyBytes : Buffer.from(bodyBytes || "", "latin1");
  const aesKey = randomUUID().slice(0, 16);
  const info = aesInfo(
    JSON.stringify({ uid: userId, security_oauth_token: authToken, name, aid: "", email }),
    aesKey,
  );
  const cosyKey = publicEncrypt(
    { key: QODER.publicKey, padding: cryptoConstants.RSA_PKCS1_PADDING },
    Buffer.from(aesKey, "utf8"),
  ).toString("base64");
  const date = String(Math.floor(Date.now() / 1000));
  const payload = Buffer.from(
    JSON.stringify({
      version: "v1",
      requestId: randomUUID(),
      info,
      cosyVersion: QODER.cosyVersion,
      ideVersion: "",
    }),
    "utf8",
  ).toString("base64");
  let sigPath = "";
  try {
    const p = new URL(url).pathname || "";
    sigPath = p.startsWith("/algo") ? p.slice(5) : p;
  } catch {}
  const sig = md5(
    Buffer.from(`${payload}\n${cosyKey}\n${date}\n${body.toString("latin1")}\n${sigPath}`, "latin1"),
  );
  const mid = machineId || randomUUID();
  return {
    Authorization: `Bearer COSY.${payload}.${sig}`,
    "Cosy-Key": cosyKey,
    "Cosy-User": userId,
    "Cosy-Date": date,
    "Cosy-Version": QODER.cosyVersion,
    "Cosy-Machineid": mid,
    "Cosy-Machinetoken": mid,
    "Cosy-Machinetype": QODER.machineType,
    "Cosy-Machineos": QODER.machineOs,
    "Cosy-Clienttype": QODER.clientType,
    "Cosy-Clientip": "127.0.0.1",
    "Cosy-Bodyhash": md5(body),
    "Cosy-Bodylength": String(body.length),
    "Cosy-Sigpath": sigPath,
    "Cosy-Data-Policy": QODER.dataPolicy,
    "Cosy-Organization-Id": "",
    "Cosy-Organization-Tags": "",
    "Login-Version": QODER.loginVersion,
    "X-Request-Id": randomUUID(),
  };
}

// ---------------------------------------------------------------------------------------------------
// Login: PKCE device flow (browser) or personal access token (pt-…) exchanged for a job token (jt-…)
// ---------------------------------------------------------------------------------------------------
const b64url = (b) => b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
export function startDeviceLogin(region = "") {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const nonce = randomUUID(),
    machineId = randomUUID();
  const q = new URLSearchParams({ challenge, challenge_method: "S256", machine_id: machineId, nonce });
  const cid = qoderEndpoints(region).clientId;
  if (cid) q.set("client_id", cid);
  return {
    nonce,
    verifier,
    machineId,
    region,
    userCode: nonce.slice(0, 8).toUpperCase(),
    url: `${qoderEndpoints(region).loginUrl}?${q}`,
    expiresAt: Date.now() + 300_000,
  };
}
export async function pollDeviceLogin({ nonce, verifier, region }, fetchImpl = fetch) {
  const r = await fetchImpl(
    `${qoderEndpoints(region).devicePoll}?nonce=${encodeURIComponent(nonce)}&verifier=${encodeURIComponent(verifier)}&challenge_method=S256`,
    {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "Go-http-client/2.0" },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (r.status === 202 || r.status === 404) return { status: "pending" };
  const text = await r.text();
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = JSON.parse(text);
      if (j.message) msg = j.message;
    } catch {}
    throw new Error(`Qoder device login failed: ${msg}`);
  }
  const j = JSON.parse(text);
  if (!j.token) throw new Error("Qoder device login returned no token");
  return {
    status: "ok",
    accessToken: j.token,
    refreshToken: j.refresh_token || "",
    userId: j.user_id || "",
    expiresAt: parseExpiry(j.expires_at, j.expires_in),
  };
}
export function parseExpiry(at, inSec) {
  if (typeof at === "number" && at > 0) return at;
  const s = typeof at === "string" ? at.trim() : "";
  if (s) {
    if (/^\d+$/.test(s)) return Number(s);
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return t;
  }
  if (typeof inSec === "number" && inSec >= 0) return Date.now() + inSec * 1000;
  return Date.now() + 30 * 86400_000;
}
export async function fetchUserInfo(token, fetchImplOrRegion = fetch, maybeFetch = null) {
  // fetchUserInfo(token, region) and fetchUserInfo(token, fetchImpl) both stay valid (older callers, tests)
  const region = typeof fetchImplOrRegion === "string" ? fetchImplOrRegion : "";
  const fetchImpl = typeof fetchImplOrRegion === "string" ? maybeFetch || fetch : fetchImplOrRegion;
  try {
    const r = await fetchImpl(qoderEndpoints(region).userInfo, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "Go-http-client/2.0",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return {};
    const j = await r.json();
    return {
      id: j.id || j.userId || j.user_id || "",
      name: (j.name || j.username || "").trim(),
      email: (j.email || "").trim(),
      organizationId: (j.organization_id || "").trim(),
    };
  } catch {
    return {};
  }
}
export async function exchangePersonalToken(pat, fetchImplOrRegion = fetch, maybeFetch = null) {
  const region = typeof fetchImplOrRegion === "string" ? fetchImplOrRegion : "";
  const fetchImpl = typeof fetchImplOrRegion === "string" ? maybeFetch || fetch : fetchImplOrRegion;
  const token = pat.startsWith("pt-") ? pat : `pt-${pat}`;
  const r = await fetchImpl(qoderEndpoints(region).patExchange, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "qodercli/1.0.0",
      "Cosy-Version": QODER.cosyVersion,
      "Cosy-ClientType": QODER.clientType,
    },
    body: JSON.stringify({ personal_token: token }),
  });
  if (!r.ok)
    throw new Error(
      `Qoder personal token exchange failed: HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`,
    );
  const j = await r.json();
  if (!j.token) throw new Error("Qoder personal token exchange returned no job token");
  const info = await fetchUserInfo(j.token, region, fetchImpl);
  return {
    accessToken: j.token,
    refreshToken: j.refresh_token || "",
    expiresAt: j.expires_at
      ? parseExpiry(j.expires_at)
      : Date.now() + (typeof j.expires_in === "number" ? j.expires_in : 86400_000),
    userId: info.id || "",
    name: info.name || "",
    email: info.email || "",
  };
}
export async function fetchQuota(token, fetchImplOrRegion = fetch, maybeFetch = null) {
  const region = typeof fetchImplOrRegion === "string" ? fetchImplOrRegion : "";
  const fetchImpl = typeof fetchImplOrRegion === "string" ? maybeFetch || fetch : fetchImplOrRegion;
  const r = await fetchImpl(qoderEndpoints(region).quota, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return { error: `HTTP ${r.status}` };
  const j = await r.json().catch(() => null);
  if (!j) return { error: "not JSON" };
  const u = j.userQuota || {},
    o = j.orgResourcePackage || {};
  return {
    user: {
      total: Number(u.total) || 0,
      used: Number(u.used) || 0,
      remaining: Number(u.remaining) || 0,
      unit: u.unit || "credits",
    },
    organization: {
      total: Number(o.total) || 0,
      used: Number(o.used) || 0,
      remaining: Number(o.remaining) || 0,
    },
    usagePercent: Number(j.totalUsagePercentage) || 0,
    exceeded: !!j.isQuotaExceeded,
    resetsAt: Number(j.expiresAt) > 0 ? new Date(Number(j.expiresAt)).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------------------------------
// Credentials on an upstream: { accessToken, refreshToken, userId, machineId, name, email, expiresAt, authMethod }
// A personal token in `apiKey` is exchanged (and cached) on demand.
// ---------------------------------------------------------------------------------------------------
const patCache = new Map(); // pat -> creds
export async function resolveCredentials(upstream, fetchImpl = fetch) {
  const q = upstream.qoder || {};
  if (q.accessToken && q.userId)
    return { ...q, region: q.region || "", authMethod: q.authMethod || "device" };
  const pat = upstream.apiKey;
  if (pat && String(pat).startsWith("pt-")) {
    const c = patCache.get(pat);
    if (c && c.expiresAt - Date.now() > 300_000) return c;
    const fresh = {
      ...(await exchangePersonalToken(pat, q.region || "", fetchImpl)),
      region: q.region || "",
      machineId: q.machineId || "",
      authMethod: "pat",
    };
    patCache.set(pat, fresh);
    return fresh;
  }
  throw new Error(
    "Qoder is not logged in: use “Log in with Qoder” on the Upstreams page, or paste a personal token (pt-…) as the API key",
  );
}
export const chatBase = (creds) => {
  const ep = qoderEndpoints(creds?.region);
  return String(creds?.accessToken || "").startsWith("jt-") ? ep.chatBaseJob : ep.chatBase;
};

// ---------------------------------------------------------------------------------------------------
// Model list (signed GET). Cached per user for an hour.
// ---------------------------------------------------------------------------------------------------
const modelCache = new Map();
export async function listModels(upstream, { force = false, fetchImpl = fetch } = {}) {
  const creds = await resolveCredentials(upstream, fetchImpl);
  const key = creds.userId || creds.accessToken;
  const cached = modelCache.get(key);
  if (!force && cached && cached.at > Date.now() - 3600_000) return cached;
  const url = `${chatBase(creds)}${QODER.modelsPath}`;
  const r = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "identity",
      ...cosyHeaders(Buffer.alloc(0), url, {
        userId: creds.userId,
        authToken: creds.accessToken,
        name: creds.name,
        email: creds.email,
        machineId: creds.machineId,
      }),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    if (isSignatureRejection(r.status, t)) throw signatureRejectionError();
    throw new Error(`Qoder model list failed: HTTP ${r.status}${t ? `: ${t.slice(0, 200)}` : ""}`);
  }
  const j = await r.json().catch(() => null);
  if (!j || !Array.isArray(j.chat)) throw new Error("Qoder model list: unexpected response");
  const configs = new Map(),
    models = [];
  for (const m of j.chat) {
    if (!m || !m.key) continue;
    configs.set(m.key, m);
    if (m.enable === false) continue;
    models.push({
      id: m.key,
      name: m.display_name || m.key,
      contextLength: Number(m.max_input_tokens) || 131072,
      maxOutput: Number(m.max_output_tokens) || 0,
      reasoning: !!m.is_reasoning,
      vision: !!m.is_vl,
    });
  }
  const out = { at: Date.now(), models, configs };
  modelCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Chat request: OpenAI-format body in -> SSE of OpenAI chunks out (as a fetch Response).
// ---------------------------------------------------------------------------------------------------
const textOf = (c) =>
  typeof c === "string"
    ? c
    : Array.isArray(c)
      ? c.map((p) => (typeof p === "string" ? p : p?.type === "text" ? p.text || "" : "")).join("\n")
      : c == null
        ? ""
        : String(c);
const sha16 = (...parts) => {
  const h = createHash("sha256");
  parts.forEach((p, i) => {
    if (i) h.update("\0");
    h.update(String(p ?? ""));
  });
  return h.digest("hex").slice(0, 16);
};

export function buildPayload({ modelId, body, modelConfig, userId }) {
  const messages = [],
    systemParts = [];
  for (const m of body.messages || []) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "system" || m.role === "developer") {
      const t = textOf(m.content);
      if (t) systemParts.push(t);
      continue;
    }
    const copy = { ...m };
    if (Array.isArray(m.content)) {
      // image parts stay (prepareAttachments already turned inline data into hosted URLs or small data URIs); everything else becomes text
      const parts = [];
      let hasImage = false;
      for (const p of m.content) {
        if (!p || typeof p !== "object") continue;
        if (p.type === "image_url") {
          const u = typeof p.image_url === "string" ? p.image_url : p.image_url?.url;
          if (u) {
            parts.push({ type: "image_url", image_url: { url: u } });
            hasImage = true;
          }
        } else if (typeof p.text === "string") parts.push({ type: "text", text: p.text });
      }
      copy.content = hasImage ? parts : parts.map((p) => p.text).join("\n");
    }
    messages.push(copy);
  }
  const system = systemParts.join("\n\n");
  const tools = Array.isArray(body.tools) ? body.tools : [];
  let maxTokens = Number(modelConfig?.max_output_tokens) || 32768;
  for (const v of [body.max_tokens, body.max_completion_tokens])
    if (typeof v === "number" && v > 0 && v < maxTokens) maxTokens = v;
  let lastUser = "";
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i].role === "user") {
      lastUser = textOf(messages[i].content);
      break;
    }
  const sessionId = sha16("qoder-session", userId, modelId);
  const recordId = (() => {
    const h = createHash("sha256");
    h.update("qoder-record\0");
    h.update(String(modelId));
    for (const m of messages) {
      if (m.role) {
        h.update("\0");
        h.update(m.role);
      }
      if (typeof m.content === "string" && m.content) {
        h.update("\0");
        h.update(m.content);
      } else if (Array.isArray(m.content)) {
        h.update("\0");
        try {
          h.update(JSON.stringify(m.content));
        } catch {}
      }
    }
    if (tools.length) {
      h.update("\0");
      try {
        h.update(JSON.stringify(tools));
      } catch {}
    }
    h.update(`\0mt=${maxTokens}`);
    return h.digest("hex").slice(0, 16);
  })();
  const cfg = { ...(modelConfig || {}), key: modelId };
  return {
    request_id: randomUUID(),
    request_set_id: recordId,
    chat_record_id: recordId,
    session_id: sessionId,
    stream: true,
    chat_task: "FREE_INPUT",
    is_reply: true,
    is_retry: false,
    source: 1,
    version: "3",
    session_type: "qodercli",
    agent_id: "agent_common",
    task_id: "common",
    code_language: "",
    chat_prompt: "",
    image_urls: null,
    aliyun_user_type: "",
    system,
    messages,
    tools,
    parameters: { max_tokens: maxTokens },
    chat_context: {
      chatPrompt: "",
      imageUrls: null,
      extra: {
        context: [],
        modelConfig: { key: modelId, is_reasoning: !!cfg.is_reasoning },
        originalContent: lastUser,
      },
      features: [],
      text: lastUser,
    },
    model_config: cfg,
    business: {
      product: "cli",
      version: "1.0.0",
      type: "agent",
      stage: "start",
      id: randomUUID(),
      name: lastUser.length > 30 ? lastUser.slice(0, 30) + "..." : lastUser,
      begin_at: Date.now(),
    },
  };
}

// Qoder's SSE lines are `data: {"statusCodeValue":200,"body":"<openai chunk json or [DONE]>"}`.
// Unwrap into a plain OpenAI SSE stream; surface non-200 inner statuses (billing blocks) as errors. Qoder is read as
// the unwrapped stream's own reader asks — a slow client holds it back rather than its reply piling up here — and a
// cancel reaches Qoder's connection.
export function unwrapStream(upstreamBody, { model }) {
  const decoder = new TextDecoder();
  let done = false,
    finished = false;
  const enc = new TextEncoder();
  const chunk = (text) => `data: ${text.replace(/\r?\n/g, "")}\n\n`;
  const reader = upstreamBody.getReader();
  /** The pull under way's controller: the lines a chunk completes are handled while it reads. @type {ReadableStreamDefaultController<Uint8Array>} */
  let controller;
  /** What went out so far: a pull reads on until it has sent something, as nothing else asks for the next. */
  let sent = 0;
  /** @param {string} text */
  const emit = (text) => {
    controller.enqueue(enc.encode(text));
    sent++;
  };
  const handle = (line) => {
    const l = line.replace(/\r$/, "").trim();
    if (!l.startsWith("data:") || done) return;
    const raw = l.slice(5).trimStart();
    if (raw === "[DONE]") {
      emit("data: [DONE]\n\n");
      done = true;
      return;
    }
    let outer;
    try {
      outer = JSON.parse(raw);
    } catch {
      return;
    }
    const status = typeof outer.statusCodeValue === "number" ? outer.statusCodeValue : 200;
    const inner =
      typeof outer.body === "string" ? outer.body : outer.body != null ? JSON.stringify(outer.body) : "";
    if (status !== 200) {
      const billing = /"code"\s*:\s*"(112|10605)"/.test(inner) || /pricingurl/i.test(inner);
      const msg = `Qoder error ${status}${billing ? " (billing/quota)" : ""}: ${inner.slice(0, 300)}`;
      emit(
        chunk(
          JSON.stringify({
            error: { message: msg, type: billing ? "insufficient_quota" : "api_error", code: status },
          }),
        ),
      );
      emit("data: [DONE]\n\n");
      done = true;
      return;
    }
    if (!inner) return;
    if (inner === "[DONE]") {
      emit("data: [DONE]\n\n");
      done = true;
      return;
    }
    let j;
    try {
      j = JSON.parse(inner);
    } catch {
      return;
    }
    if (j && typeof j === "object") {
      if (j.model == null) j.model = model;
      if (j.object == null) j.object = "chat.completion.chunk";
      if (!j.id || String(j.id).length < 8) j.id = `chatcmpl-qoder-${Date.now()}`;
      if (Array.isArray(j.choices) && j.choices.some((c) => c?.finish_reason)) finished = true;
      emit(chunk(JSON.stringify(j)));
    }
  };
  // A line past what Filament reads of one (`LINE_MAX`) is no chunk of a reply: the reply ends there with an error that
  // says so, and Qoder is read no further.
  const lines = createLineReader(
    (line) => {
      handle(line);
      return done;
    },
    {
      onOver: (over) => {
        if (done) return true;
        const message = `Qoder sent a line of ${Math.round(over.length / 2 ** 20)} MiB, past the ${LINE_MAX / 2 ** 20} MiB Filament reads of one: the reply ends here`;
        emit(chunk(JSON.stringify({ error: { message, type: "api_error" } })));
        emit("data: [DONE]\n\n");
        done = true;
        return true;
      },
    },
  );
  return new ReadableStream({
    async pull(c) {
      controller = c;
      const had = sent;
      try {
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) {
            // Qoder's end: its last line, which no newline closed (one past `LINE_MAX` ends the reply as at its
            // newline), then the [DONE] it did not say itself. A reply that broke off with no finish of its own ends as
            // an error, never with a finish Qoder never sent.
            const last = lines.end() + decoder.decode();
            if (last.trim()) handle(last);
            if (!done) {
              if (!finished) emit(chunk(JSON.stringify({ error: { message: INCOMPLETE_STREAM, type: "api_error" } })));
              emit("data: [DONE]\n\n");
            }
            break;
          }
          lines.push(decoder.decode(value, { stream: true }));
          if (done) {
            await reader.cancel().catch(() => {});
            break;
          }
          if (sent > had) return; // the next pull reads on
        }
      } catch (e) {
        try {
          emit(chunk(JSON.stringify({ error: { message: e.message, type: "api_error" } })));
          emit("data: [DONE]\n\n");
        } catch {}
      }
      try {
        c.close();
      } catch {}
    },
    cancel() {
      return reader.cancel();
    },
  });
}

// Send one chat request. Returns a fetch-style Response (SSE of OpenAI chunks, or a JSON error).
export async function chat({
  upstream,
  modelId,
  body,
  signal,
  fetchImpl = providerFetch,
  log = () => {},
}) {
  const creds = await resolveCredentials(upstream, fetchImpl);
  let configs;
  try {
    configs = (await listModels(upstream, { fetchImpl })).configs;
  } catch {
    configs = new Map();
  }
  const modelConfig = configs.get(modelId) || { key: modelId, source: "system" };
  const prepared = await prepareAttachments(body, creds, { fetchImpl, signal, log });
  const notes = [...prepared.notes];
  body = prepared.body;
  if (prepared.images && modelConfig.is_vl === false)
    notes.push(
      `qoder: Qoder's model list does not flag ${modelId} as a vision model; if the answer ignores the image, pick one that is`,
    );
  const payload = buildPayload({ modelId, body, modelConfig, userId: creds.userId });
  if (Buffer.byteLength(JSON.stringify(payload)) > QODER_ATTACH.bodyCapBytes)
    throw new Error(
      `request is larger than Qoder's ${Math.round(QODER_ATTACH.bodyCapBytes / 1048576)} MB limit even after uploading images; remove some attachments`,
    );
  const bytes = obfuscate(JSON.stringify(payload));
  const url = `${chatBase(creds)}${QODER.chatPath}?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Model-Key": modelId,
    "X-Model-Source": modelConfig.source || "system",
    "Accept-Encoding": "identity",
    ...cosyHeaders(bytes, url, {
      userId: creds.userId,
      authToken: creds.accessToken,
      name: creds.name,
      email: creds.email,
      machineId: creds.machineId,
    }),
  };
  // No clock (HarnessV3-FailurePoints §4 A): Qoder answers or fails, or the client hangs up (`signal`).
  const res = await fetchImpl(url, { method: "POST", headers, body: bytes, signal, redirect: "manual" });
  // A redirect is never followed (fetch.js), nor answered to the client as though it were Qoder's reply.
  if (redirected(res)) throw redirectRefusal("its server", res);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (isSignatureRejection(res.status, t)) throw signatureRejectionError();
    return {
      res: new Response(t, {
        status: res.status,
        headers: { "content-type": res.headers?.get?.("content-type") || "application/json" },
      }),
      url,
      headers,
      payload,
      notes,
    };
  }
  if (!res.body) return { res, url, headers, payload, notes };
  return {
    res: new Response(unwrapStream(res.body, { model: modelId }), {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "x-qoder-request-id": payload.request_id,
      },
    }),
    url,
    headers,
    payload,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------------
// The Qoder cloud as a destination (core/ports.js `Destination`): the signed, obfuscated chat call behind `open`,
// the account's model list, and the connection test the dashboard shows.
// ---------------------------------------------------------------------------------------------------
export async function testQoder(u, { fetchImpl = fetch } = {}) {
  const t0 = performance.now();
  try {
    const creds = await resolveCredentials(u, fetchImpl);
    const list = await listModels(u, { force: true, fetchImpl });
    const quota = await fetchQuota(creds.accessToken, creds.region, fetchImpl).catch((e) => ({
      error: e.message,
    }));
    return {
      ok: true,
      status: 200,
      ms: Math.round(performance.now() - t0),
      models: list.models.length,
      sample: list.models
        .slice(0, 8)
        .map((m) => m.id)
        .join(", "),
      account: creds.email || creds.name || creds.userId,
      method: creds.authMethod,
      expiresAt: creds.expiresAt || null,
      quota,
    };
  } catch (e) {
    return { ok: false, status: 0, ms: Math.round(performance.now() - t0), error: e.message };
  }
}

/** @returns {import("../../core/ports.js").Destination} */
export function qoderDestination(upstream, { log = () => {}, fetchImpl = providerFetch } = {}) {
  return {
    id: upstream.id,
    type: upstream.type,
    label: "Qoder",
    transport: null,
    agent: null,
    answers: {
      async open({ body, modelId, signal }) {
        const q = await chat({
          upstream,
          modelId,
          body,
          signal,
          fetchImpl,
          log,
        });
        return { res: q.res, url: q.url, notes: q.notes || [], cleanup() {} };
      },
      unreachable: (e) => ({
        message: `Qoder: ${e.message}`,
        retryable: /timeout|ECONN|fetch/i.test(e.message),
      }),
    },
    listModels: async (opts = {}) => {
      const r = await listModels(upstream, { ...opts, fetchImpl });
      return { names: r.models.map((m) => m.id), source: "discovered" };
    },
    test: () => testQoder(upstream, { fetchImpl }),
  };
}
