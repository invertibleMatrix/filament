// @ts-check
// Antigravity's plan quota (HarnessV3-ACP AC3-6). agy says nothing of its plan's quota over ACP — its own screen's
// `/usage` reads it from Google's Code Assist service with its Google sign-in — so Filament reads it the same way,
// with the sign-in agy keeps: an account with a folder of its own keeps it in a file there, the Default account in the
// system's keyring (Windows' Credential Manager, the macOS keychain, the Secret Service on Linux). The sign-in is read,
// never written, never renewed here (agy keeps no client of its own beside it), and goes to Google alone; one that has
// expired waits for agy's next run, which renews it and saves the renewal where it read it — so the reads come with
// Antigravity's turns. Read live on agy 1.5.14 (11-22): the service answers a client whose name says it runs agy
// (`antigravity/<version>`) and refuses one that doesn't.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, win32 } from "node:path";
import { agyQuotaWindows } from "../../core/agent-limits.js";

/**
 * Google's two hosts for the service: the one that meters a consumer's Google account (its daily host), and the one
 * that meters Gemini Enterprise — each says what it meters, the other what it last heard.
 */
export const AGY_QUOTA_HOSTS = Object.freeze({ daily: "https://daily-cloudcode-pa.googleapis.com", prod: "https://cloudcode-pa.googleapis.com" });
/** How long one of the service's answers is waited for. */
const ANSWER_MS = 10_000;
/** How long before its expiry a sign-in is taken as expired: an ask under way would outlive it. */
const EXPIRY_MARGIN_MS = 60_000;
/** Where agy keeps its Google sign-in in the system's keyring (its service and user, as go-keyring names them). */
const KEYRING = Object.freeze({ service: "gemini", user: "antigravity" });

/**
 * agy's Google sign-in as Filament reads it: its access token, when it expires (epoch ms; null where it doesn't say),
 * the account's email, how it signed in (`consumer` for a Google account), and where it was kept.
 * @typedef {{ access: string, expiresAt: number | null, email: string | null, method: string | null, from: "file" | "keyring" }} AgySignIn
 */

/**
 * The file agy keeps an account's Google sign-in in, where it keeps it in a file: under its folder (`--gemini-dir`),
 * or the Default account's (`~/.gemini`).
 * @param {string | null | undefined} home  the account's folder; none for the Default account
 */
export const agyTokenFile = (home) => join(String(home || "").trim() || join(homedir(), ".gemini"), "antigravity-acp", "antigravity-oauth-token");

/**
 * What agy keeps, as text: go-keyring writes it plain, or behind a mark of how it encoded it (`go-keyring-base64:`,
 * `go-keyring-encoded:`), as it does on macOS.
 * @param {string} text
 */
export function keptText(text) {
  const s = String(text || "").trim();
  if (s.startsWith("go-keyring-base64:")) return Buffer.from(s.slice("go-keyring-base64:".length), "base64").toString("utf8");
  if (s.startsWith("go-keyring-encoded:")) return Buffer.from(s.slice("go-keyring-encoded:".length), "hex").toString("utf8");
  return s;
}

/**
 * agy's sign-in from what it keeps: `{ token: { access_token, expiry }, auth_method, id_token_email }` (read live on
 * 1.5.14). Null where it holds no access token.
 * @param {string} text @param {"file" | "keyring"} from
 * @returns {AgySignIn | null}
 */
export function readSignIn(text, from) {
  let j;
  try {
    j = JSON.parse(keptText(text));
  } catch {
    return null;
  }
  const access = j?.token?.access_token;
  if (typeof access !== "string" || !access) return null;
  const expiry = typeof j.token.expiry === "string" ? Date.parse(j.token.expiry) : NaN;
  return {
    access,
    expiresAt: Number.isFinite(expiry) ? expiry : null,
    email: typeof j.id_token_email === "string" && j.id_token_email.includes("@") ? j.id_token_email : null,
    method: typeof j.auth_method === "string" && j.auth_method ? j.auth_method : null,
    from,
  };
}

/**
 * A command's output, or null where it says what it was asked for isn't there (`missing`: its exit codes for that).
 * Its failure says the program and its first line of errors, never its arguments.
 * @param {string} cmd @param {string[]} args @param {number[]} missing @param {string} what  what it reads, for its failure
 * @returns {Promise<string | null>}
 */
const output = (cmd, args, missing, what) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15_000, windowsHide: true, maxBuffer: 1_000_000 }, (e, stdout, stderr) => {
      if (!e) return resolve(String(stdout));
      const code = /** @type {any} */ (e).code;
      if (typeof code === "number" && missing.includes(code)) return resolve(null);
      const said = String(stderr || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";
      const how = code === "ENOENT" ? "isn't on this computer" : /** @type {any} */ (e).killed ? "gave no answer in 15 s" : `failed${typeof code === "number" ? ` (exit code ${code})` : ""}${said ? `: ${said.slice(0, 200)}` : ""}`;
      reject(new Error(`${what} couldn't be read: ${cmd.split(/[\\/]/).pop()} ${how}`));
    });
  });

/**
 * Windows PowerShell's script that reads a generic credential of Windows' Credential Manager (`CredReadW`) and writes
 * its bytes in base64; nothing where there is none. Its target is one of Filament's own, never words from outside.
 * @param {string} target
 */
export function credentialScript(target) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class FilamentKeyring {",
    "  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]",
    "  struct Credential { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten; public int BlobSize; public IntPtr Blob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }",
    '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);',
    '  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr credential);',
    "  public static string Read(string target) {",
    "    IntPtr p;",
    "    if (!CredReadW(target, 1, 0, out p)) { int e = Marshal.GetLastWin32Error(); if (e == 1168) return \"\"; throw new System.ComponentModel.Win32Exception(e); }",
    "    try { var c = (Credential)Marshal.PtrToStructure(p, typeof(Credential)); var b = new byte[c.BlobSize]; Marshal.Copy(c.Blob, b, 0, b.Length); return Convert.ToBase64String(b); }",
    "    finally { CredFree(p); }",
    "  }",
    "}",
    "'@",
    `[Console]::Out.Write([FilamentKeyring]::Read('${target.replace(/'/g, "''")}'))`,
  ].join("\n");
}

/**
 * Bytes kept in Windows' Credential Manager as text: go-keyring writes UTF-8; a credential written by Windows' own
 * tools holds UTF-16.
 * @param {Buffer} b
 */
export function credentialText(b) {
  const utf16 = b.length >= 4 && b.length % 2 === 0 && b[1] === 0 && b[3] === 0;
  return b.toString(utf16 ? "utf16le" : "utf8");
}

/**
 * agy's Google sign-in from the system's keyring, as go-keyring keeps it — its service `gemini`, its user
 * `antigravity` (on Windows the credential `gemini:antigravity`) —, read with the system's own tools: Windows
 * PowerShell, `security` on macOS (go-keyring writes the keychain through it, so reading it asks nobody), Linux's
 * `secret-tool`. Null where none is kept.
 * @param {string} platform
 * @returns {Promise<string | null>}
 */
export async function readKeyring(platform) {
  if (platform === "win32") {
    const encoded = Buffer.from(credentialScript(`${KEYRING.service}:${KEYRING.user}`), "utf16le").toString("base64");
    // Windows PowerShell by its full path: a bare name is looked for in the working folder first.
    const ps = win32.join(process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const out = await output(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], [], "Windows' Credential Manager");
    const b64 = String(out || "").trim();
    return b64 ? credentialText(Buffer.from(b64, "base64")) : null;
  }
  if (platform === "darwin") return output("/usr/bin/security", ["find-generic-password", "-s", KEYRING.service, "-a", KEYRING.user, "-w"], [44], "The keychain");
  const out = await output("secret-tool", ["lookup", "service", KEYRING.service, "username", KEYRING.user], [1], "The system's keyring");
  return out && out.trim() ? out : null;
}

/**
 * agy's Google sign-in for an account, as agy keeps it renewed (it saves each renewal where it read the sign-in): an
 * added account's in the file in its folder; the Default account's in the system's keyring, or in the file where agy
 * takes itself to run over SSH or can't write the keyring — the later-expiring of the two where both hold one, an
 * old one left behind in the other. Null where none is kept; a keyring that can't be read where the file holds one is
 * no failure.
 * @param {{ home?: string | null, platform?: string, read?: (file: string) => Promise<string>, keyring?: (platform: string) => Promise<string | null> }} o
 * @returns {Promise<AgySignIn | null>}
 */
export async function agySignIn({ home = null, platform = process.platform, read = (f) => readFile(f, "utf8"), keyring = readKeyring }) {
  const text = await read(agyTokenFile(home)).catch((e) => {
    if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return null;
    throw e;
  });
  const filed = text != null ? readSignIn(text, "file") : null;
  if (String(home || "").trim()) return filed;
  const kept = filed ? await keyring(platform).catch(() => null) : await keyring(platform);
  const keyed = kept ? readSignIn(kept, "keyring") : null;
  if (!filed || !keyed) return filed || keyed;
  return (keyed.expiresAt ?? 0) > (filed.expiresAt ?? 0) ? keyed : filed;
}

/** This computer as agy's own name for a client says it (`windows/amd64`). @param {string} platform @param {string} arch */
const systemOf = (platform, arch) => `${platform === "win32" ? "windows" : platform}/${arch === "x64" ? "amd64" : arch}`;

/**
 * What the service said to a client's ask: its answer, or why there is none.
 * @param {(url: string, init: any) => Promise<any>} fetch @param {string} url @param {string} access @param {string} agent
 * @returns {Promise<{ answer: any } | { error: string, status: number | null }>}
 */
async function ask(fetch, url, access, agent) {
  try {
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", "User-Agent": agent }, body: "{}", redirect: "manual", signal: AbortSignal.timeout(ANSWER_MS) });
    const text = String(await res.text());
    if (res.status === 200) return { answer: JSON.parse(text) };
    let said = "";
    try {
      said = String(JSON.parse(text)?.error?.message || "");
    } catch {}
    const first = said.split(/(?<=\.)\s/)[0].trim();
    return { status: res.status, error: res.status === 401 ? "Google refused its sign-in (401): it renews when Antigravity next runs" : `Google answered ${res.status}${first ? `: ${first.replace(/\.$/, "")}` : ""}` };
  } catch (e) {
    return { status: null, error: /** @type {any} */ (e)?.name === "TimeoutError" ? `Google gave no answer in ${ANSWER_MS / 1000} s` : String(/** @type {any} */ (e)?.message || e) };
  }
}

/**
 * The plan's windows as Google's service says them for the sign-in: its quota summary and its models' quota, each
 * from the host that meters the sign-in's way where it answered, else the other's — the other says what it last heard
 * — read as one (`agyQuotaWindows`), the plan's whole set. The client's name is Filament's, with agy's version, which
 * the service asks for. Fails where no host answered.
 * @param {{ signIn: AgySignIn, agyVersion: string, filamentVersion: string, platform?: string, arch?: string,
 *   fetch?: (url: string, init: any) => Promise<any>, hosts?: { daily: string, prod: string } }} o
 * @returns {Promise<import("../../core/agent-limits.js").PlanWindow[]>}
 */
export async function readAgyQuota({ signIn, agyVersion, filamentVersion, platform = process.platform, arch = process.arch, fetch = globalThis.fetch, hosts = AGY_QUOTA_HOSTS }) {
  const agent = `Filament/${filamentVersion} antigravity/${agyVersion || "1.5"} ${systemOf(platform, arch)}`;
  const order = !signIn.method || signIn.method === "consumer" ? [hosts.daily, hosts.prod] : [hosts.prod, hosts.daily];
  const read = await Promise.all(
    order.map(async (host) => {
      const [summary, models] = await Promise.all(["retrieveUserQuotaSummary", "fetchAvailableModels"].map((op) => ask(fetch, `${host}/v1internal:${op}`, signIn.access, agent)));
      return { summary, models };
    }),
  );
  /** The first host's answer to a call, in their order. @param {"summary" | "models"} call */
  const first = (call) => {
    const r = read.map((h) => h[call]).find((x) => "answer" in x);
    return r && "answer" in r ? r.answer : null;
  };
  const summary = first("summary");
  const models = first("models");
  if (summary == null && models == null) {
    const failed = read.flatMap((h) => [h.summary, h.models]).find((r) => "error" in r);
    throw new Error(failed && "error" in failed ? failed.error : "Google's quota service gave no answer");
  }
  return agyQuotaWindows(summary, models);
}

/** Whether a sign-in has expired, or will before an ask could end. @param {AgySignIn} s @param {number} [now] */
export const signInExpired = (s, now = Date.now()) => s.expiresAt != null && s.expiresAt <= now + EXPIRY_MARGIN_MS;
