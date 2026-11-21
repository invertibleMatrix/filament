// @ts-check
// The certificate LAN over TLS serves (the owner's remote Filament of 11-06, Part 2), made with node:crypto alone: Node's
// own X509Certificate reads it whole, it verifies under its own key, and a real TLS handshake with it as the one trusted
// certificate succeeds by its names — and pinned by its fingerprint, with no names at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import tls from "node:tls";
import { X509Certificate, generateKeyPairSync } from "node:crypto";
import { MAX_DAYS, fingerprintOf, printOf, samePrint, selfSigned } from "../src/core/x509.js";

const keys = () => generateKeyPairSync("ec", { namedCurve: "P-256" });

// (fails before: yes — there was no certificate builder, and Node makes none)
test("a self-signed EC P-256 certificate: Node reads it whole, it verifies under its key, and says its names and dates", () => {
  const { privateKey, publicKey } = keys();
  const now = Date.UTC(2026, 10, 6, 12, 0, 0);
  const { pem, der } = selfSigned({ privateKey, publicKey, name: "Filament on Workstation", dns: ["localhost", "workstation", "workstation.local", "localhost"], ips: ["127.0.0.1", "192.168.1.20", "fe80::1", "not-an-ip"], now });
  assert.match(pem, /^-----BEGIN CERTIFICATE-----\n([A-Za-z0-9+/=]{1,64}\n)+-----END CERTIFICATE-----\n$/);
  const cert = new X509Certificate(pem);
  assert.ok(cert.verify(publicKey), "signed by its own key");
  assert.equal(cert.subject, "CN=Filament on Workstation");
  assert.equal(cert.issuer, cert.subject, "self-signed");
  assert.equal(cert.ca, false);
  assert.deepEqual(cert.keyUsage, ["1.3.6.1.5.5.7.3.1"], "for a TLS server alone");
  assert.equal(cert.subjectAltName, "DNS:localhost, DNS:workstation, DNS:workstation.local, IP Address:127.0.0.1, IP Address:192.168.1.20, IP Address:FE80:0:0:0:0:0:0:1");
  assert.equal(cert.checkIP("192.168.1.20"), "192.168.1.20");
  assert.equal(cert.checkHost("workstation.local"), "workstation.local");
  assert.equal(Date.parse(cert.validFrom), now - 3_600_000, "an hour back, for a clock a little behind");
  // (fails before: yes — the hour back came on top of the 825 days, one hour more than Apple's TLS checks take)
  assert.equal(Date.parse(cert.validTo) - Date.parse(cert.validFrom), MAX_DAYS * 86_400_000, "825 days in all, the hour back with them: the most Apple's TLS checks take");
  assert.equal(cert.publicKey.asymmetricKeyDetails?.namedCurve, "prime256v1");
  assert.equal(fingerprintOf(der), cert.fingerprint256);
  assert.equal(fingerprintOf(pem), cert.fingerprint256);
  // Past 2049 a time is a GeneralizedTime; a serial with its top bit set stays positive.
  const late = new X509Certificate(selfSigned({ privateKey, publicKey, name: "x", now: Date.UTC(2049, 11, 1), serial: Buffer.alloc(16, 0xff) }).pem);
  assert.equal(new Date(late.validTo).getUTCFullYear(), 2052);
  assert.match(late.serialNumber, /^7F/i);
});

test("fingerprints: one form, however written; an empty or short one matches none", () => {
  const fp = "ab:cd:" + "01:".repeat(29) + "ef";
  assert.equal(printOf("abcd" + "01".repeat(29) + "EF"), fp.toUpperCase());
  assert.equal(printOf("AB CD " + "01 ".repeat(29) + "EF"), fp.toUpperCase());
  assert.ok(samePrint(fp, fp.toUpperCase().replace(/:/g, "")));
  assert.ok(!samePrint("", ""));
  assert.ok(!samePrint("ab:cd", "AB:CD"), "a part of one is none");
  assert.ok(!samePrint(fp, fp.replace(/ef$/, "ee")));
});

/**
 * A TLS server on a free loopback port with the certificate, answering "ok"; `connect` dials it with the options given
 * and answers what the client saw.
 * @param {{ key: string, cert: string }} creds
 */
async function serve(creds) {
  const server = tls.createServer({ ...creds, minVersion: "TLSv1.2" }, (s) => s.end("ok"));
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  /** @param {tls.ConnectionOptions} o @returns {Promise<{ authorized: boolean, error?: string, fp?: string, said?: string }>} */
  const connect = (o) =>
    new Promise((resolve) => {
      const s = tls.connect({ host: "127.0.0.1", port, ...o }, () => {
        const fp = s.getPeerCertificate().fingerprint256;
        let said = "";
        s.on("data", (d) => (said += d)).on("end", () => resolve({ authorized: s.authorized, fp, said }));
      });
      s.on("error", (e) => resolve({ authorized: false, error: /** @type {any} */ (e).code || e.message }));
    });
  return { connect, close: () => new Promise((r) => server.close(() => r(null))) };
}

test("a real TLS handshake: trusted as itself it verifies by its names, pinned it needs none, and a stranger's client refuses it", async () => {
  const { privateKey, publicKey } = keys();
  const { pem } = selfSigned({ privateKey, publicKey, name: "Filament on Workstation", dns: ["localhost"], ips: ["127.0.0.1"] });
  const key = /** @type {string} */ (privateKey.export({ type: "pkcs8", format: "pem" }));
  const at = await serve({ key, cert: pem });
  try {
    const trusted = await at.connect({ ca: [pem], servername: "localhost" });
    assert.deepEqual([trusted.authorized, trusted.said], [true, "ok"], "the certificate as its own trust verifies, its name checked");
    const byIp = await at.connect({ ca: [pem] });
    assert.equal(byIp.authorized, true, "by its address, in its subjectAltName");
    const wrongName = await at.connect({ ca: [pem], servername: "elsewhere.example" });
    assert.equal(wrongName.authorized, false, "a name it is not for");
    const stranger = await at.connect({});
    assert.equal(stranger.error, "DEPTH_ZERO_SELF_SIGNED_CERT", "no client trusts it on its own");
    const pinned = await at.connect({ rejectUnauthorized: false });
    assert.ok(samePrint(String(pinned.fp), fingerprintOf(pem)), "what a pinning client compares");
    assert.equal(pinned.said, "ok");
  } finally {
    await at.close();
  }
});
