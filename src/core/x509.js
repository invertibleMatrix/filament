// @ts-check
// A self-signed certificate made with node:crypto alone (the owner's remote Filament of 11-06, Part 2 — LAN over TLS):
// Node signs and parses certificates but makes none, so the few DER structures one needs are written here. The key is
// EC P-256, signed with ECDSA over SHA-256; the certificate names its machine, its addresses and its host names, and is
// for a TLS server alone (keyUsage digitalSignature, extKeyUsage serverAuth, no CA). It meets what Apple's TLS checks ask
// of any server certificate (a subjectAltName, serverAuth, SHA-256, 825 days at the most), so Safari, like Chrome and
// Firefox, lets the person go on past its warning. Trust comes from pinning, never a CA: the client compares the
// certificate's SHA-256 fingerprint (`fingerprintOf`) with the one the machine itself shows.
import { X509Certificate, createHash, randomBytes, sign } from "node:crypto";

/** The longest a server certificate may last that Apple's TLS checks take: 825 days. */
export const MAX_DAYS = 825;

/** @param {number} n */
const lengthOf = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  /** @type {number[]} */
  const bytes = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) bytes.unshift(x & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
/** A DER element: its tag, its length, its parts. @param {number} tag @param {...Buffer} parts */
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), lengthOf(body.length), body]);
};
/** @param {...Buffer} parts */
const seq = (...parts) => tlv(0x30, ...parts);
/** @param {...Buffer} parts */
const set = (...parts) => tlv(0x31, ...parts);
/** A non-negative INTEGER from its big-endian bytes. @param {Buffer} bytes */
const int = (bytes) => {
  let b = bytes;
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  return tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
};
/** @param {string} dotted */
const oid = (dotted) => {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const out = [40 * a + b];
  for (const v of rest) {
    const part = [v & 0x7f];
    for (let x = Math.floor(v / 128); x > 0; x = Math.floor(x / 128)) part.unshift((x & 0x7f) | 0x80);
    out.push(...part);
  }
  return tlv(0x06, Buffer.from(out));
};
/** A time: UTCTime until 2050, GeneralizedTime from then on (RFC 5280 4.1.2.5). @param {number} ms */
const time = (ms) => {
  const s = new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z";
  return new Date(ms).getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(s.slice(2), "ascii")) : tlv(0x18, Buffer.from(s, "ascii"));
};
/** An extension: its id, whether a client must understand it, its value. @param {string} id @param {boolean} critical @param {Buffer} value */
const extension = (id, critical, value) => seq(oid(id), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), tlv(0x04, value));
/** An IP address's bytes, v4 or v6; null for what is no address. @param {string} ip */
const ipBytes = (ip) => {
  const s = String(ip);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
    const parts = s.split(".").map(Number);
    return parts.every((n) => n < 256) ? Buffer.from(parts) : null;
  }
  if (!/^[0-9a-f:]+$/i.test(s) || !s.includes(":") || s.split("::").length > 2) return null;
  const [head, tail = ""] = s.split("::");
  const groups = (/** @type {string} */ g) => (g ? g.split(":") : []);
  const all = s.includes("::") ? [...groups(head), ...Array(Math.max(0, 8 - groups(head).length - groups(tail).length)).fill("0"), ...groups(tail)] : groups(s);
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return Buffer.from(all.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]));
};

const ECDSA_SHA256 = "1.2.840.10045.4.3.2";

/**
 * A self-signed certificate for a TLS server, as PEM and DER.
 * @param {{ privateKey: import("node:crypto").KeyObject, publicKey: import("node:crypto").KeyObject, name: string, dns?: string[], ips?: string[], days?: number, now?: number, serial?: Buffer }} o
 *   `name`: its subject and issuer's common name; `dns`, `ips`: the names and addresses it is for (subjectAltName)
 * @returns {{ pem: string, der: Buffer }}
 */
export function selfSigned({ privateKey, publicKey, name, dns = [], ips = [], days = MAX_DAYS, now = Date.now(), serial = randomBytes(16) }) {
  const subject = seq(set(seq(oid("2.5.4.3"), tlv(0x0c, Buffer.from(String(name).slice(0, 64), "utf8")))));
  const alt = seq(
    ...[...new Set(dns.map(String).filter(Boolean))].map((d) => tlv(0x82, Buffer.from(d, "ascii"))),
    ...[...new Set(ips.map(String))].flatMap((ip) => {
      const bytes = ipBytes(ip);
      return bytes ? [tlv(0x87, bytes)] : [];
    }),
  );
  const tbs = seq(
    tlv(0xa0, int(Buffer.from([2]))), // v3
    int(Buffer.concat([Buffer.from([serial[0] & 0x7f]), serial.subarray(1)])),
    seq(oid(ECDSA_SHA256)),
    subject,
    // An hour back, so a clock a little behind this machine's takes it at once.
    // The hour back counts inside the days: Apple's check is of the whole span (the review of p2-lan).
    seq(time(now - 3_600_000), time(now - 3_600_000 + Math.min(MAX_DAYS, days) * 86_400_000)),
    subject,
    publicKey.export({ type: "spki", format: "der" }),
    tlv(0xa3, seq(
      extension("2.5.29.19", true, seq()), // basicConstraints: no CA
      extension("2.5.29.15", true, tlv(0x03, Buffer.from([0x07, 0x80]))), // keyUsage: digitalSignature
      extension("2.5.29.37", false, seq(oid("1.3.6.1.5.5.7.3.1"))), // extKeyUsage: serverAuth
      extension("2.5.29.17", false, alt),
    )),
  );
  const der = seq(tbs, seq(oid(ECDSA_SHA256)), tlv(0x03, Buffer.from([0]), sign("sha256", tbs, privateKey)));
  const b64 = der.toString("base64").replace(/.{64}/g, "$&\n").replace(/\n$/, "");
  return { pem: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`, der };
}

/** A fingerprint in one form: its hex digits, upper case, in pairs joined by colons — as browsers and Node show it. @param {string} fp */
export const printOf = (fp) => (String(fp || "").replace(/[^0-9a-f]/gi, "").toUpperCase().match(/../g) || []).join(":");

/** A certificate's SHA-256 fingerprint (`AB:CD:…`), from its PEM or DER. @param {string | Buffer} cert */
export const fingerprintOf = (cert) => new X509Certificate(cert).fingerprint256;

/**
 * The SHA-256 of a certificate's public key (its SubjectPublicKeyInfo), written as a fingerprint is (`AB:CD:…`): the
 * same for every certificate its key signs, so one renewed with the same key keeps it (services/lan-tls.js `lanIdentity`,
 * services/machines/key-pins.js). @param {string | Buffer} cert  its PEM or DER
 */
export const keyPrintOf = (cert) => printOf(createHash("sha256").update(new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" })).digest("hex"));

/** Whether two fingerprints are one, however each is written (colons, spaces, case); an empty one is none. @param {string} a @param {string} b */
export const samePrint = (a, b) => {
  const x = printOf(a);
  return x.length === 95 && x === printOf(b);
};
