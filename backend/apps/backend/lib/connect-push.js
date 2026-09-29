"use strict";

// WSS Connect Web Push sender. This is intentionally dependency-free: Node's
// P-256, HKDF/HMAC, and AES-GCM primitives implement RFC 8291/8188 directly,
// while RFC 8292 VAPID authenticates the POST to each browser push service.
//
// The push body is deliberately tiny. It contains only a sender label, an
// 80-character message preview, and the Connect thread target. Subscription
// endpoints and tenant slugs are capability data and never enter the payload
// or event log.

const {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
} = require("node:crypto");
const { isIP } = require("node:net");
const { slugify } = require("./dashboard-link");
const { recordEvent, select } = require("./store");

const SUBSCRIPTIONS_TABLE = "connect_push_subscriptions";
const MAX_SUBSCRIPTIONS = 100;
const PUSH_TIMEOUT_MS = 8_000;
const RECORD_SIZE = 4_096;
const MAX_PLAINTEXT_BYTES = 3_993;

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value, expectedBytes, label) {
  const text = String(value || "").trim().replace(/=+$/, "");
  if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) {
    const error = new Error(`${label}_invalid`);
    error.code = `${label}_invalid`;
    throw error;
  }
  const decoded = Buffer.from(text, "base64url");
  if (!expectedBytes.includes(decoded.length)) {
    const error = new Error(`${label}_invalid_length`);
    error.code = `${label}_invalid_length`;
    throw error;
  }
  return decoded;
}

function redactLockScreenPii(value) {
  const emailRedacted = String(value || "").replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[redacted]",
  );
  // Redact digit runs that look like phone numbers, including slash-separated,
  // Unicode-dash, and non-ASCII digit forms. Short ordinary numbers remain.
  return emailRedacted.replace(/\+?[\p{Nd}][\p{Nd}\s().\-/\\\u2013\u2014\u2015]{5,}[\p{Nd}]/gu, (candidate) => (
    (candidate.match(/\p{Nd}/gu) || []).length >= 7 ? "[redacted]" : candidate
  ));
}

function cleanText(value, maxCodePoints) {
  const cleaned = redactLockScreenPii(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, maxCodePoints).join("");
}

function cleanThreadId(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(text)) return null;
  const digits = (text.match(/\d/g) || []).length;
  if (digits >= 7 && !/[A-Za-z]/.test(text)) return null;
  return text;
}

function cleanKind(value) {
  return String(value || "message")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40) || "message";
}

/**
 * The exact browser-visible allowlist. Extra caller fields are ignored.
 * `kind` is intentionally not included; it stays server-side for telemetry.
 */
function buildConnectPushPayload({ sender, snippet, threadId } = {}) {
  return {
    title: cleanText(sender, 80) || "Website visitor",
    body: cleanText(snippet, 80) || "New website message",
    threadId: cleanThreadId(threadId),
  };
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

// All HKDF outputs used by Web Push are <= one SHA-256 block, so RFC 5869's
// expand step is the single HMAC(info || 0x01) form.
function hkdfExpand(prk, info, length) {
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

function readVapidConfig(env = process.env) {
  const privateBytes = decodeBase64Url(
    env.CONNECT_VAPID_PRIVATE_KEY,
    [32],
    "vapid_private_key",
  );
  const signingCurve = createECDH("prime256v1");
  signingCurve.setPrivateKey(privateBytes);
  const derivedPublic = signingCurve.getPublicKey(null, "uncompressed");

  const configuredPublic = String(env.CONNECT_VAPID_PUBLIC_KEY || "").trim();
  if (configuredPublic) {
    const publicBytes = decodeBase64Url(configuredPublic, [65], "vapid_public_key");
    if (!publicBytes.equals(derivedPublic)) {
      const error = new Error("vapid_key_mismatch");
      error.code = "vapid_key_mismatch";
      throw error;
    }
  }

  const publicKey = base64Url(derivedPublic);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: base64Url(privateBytes),
    x: base64Url(derivedPublic.subarray(1, 33)),
    y: base64Url(derivedPublic.subarray(33, 65)),
  };
  const privateKey = createPrivateKey({ key: jwk, format: "jwk" });
  const subject = String(env.CONNECT_VAPID_SUBJECT || "https://wss-labs.com").trim();
  let subjectUrl;
  try { subjectUrl = new URL(subject); } catch { subjectUrl = null; }
  if (!subjectUrl || !["https:", "mailto:"].includes(subjectUrl.protocol)) {
    const error = new Error("vapid_subject_invalid");
    error.code = "vapid_subject_invalid";
    throw error;
  }
  return { privateKey, publicKey, subject };
}

function vapidAuthorization(endpoint, config, nowMs = Date.now()) {
  const audience = new URL(endpoint).origin;
  const header = base64Url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64Url(Buffer.from(JSON.stringify({
    aud: audience,
    exp: Math.floor(nowMs / 1000) + (12 * 60 * 60),
    sub: config.subject,
  })));
  const unsigned = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${unsigned}.${base64Url(signature)}, k=${config.publicKey}`;
}

function supportedPushHost(hostname) {
  return hostname === "fcm.googleapis.com"
    || hostname === "updates.push.services.mozilla.com"
    || hostname === "push.services.mozilla.com"
    || hostname === "web.push.apple.com"
    || hostname === "notify.windows.com"
    || hostname.endsWith(".notify.windows.com");
}

function normalizePushEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(String(value || "").trim()); } catch { return ""; }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) return "";
  const hostname = endpoint.hostname.toLowerCase();
  const unwrappedHost = hostname.replace(/^\[|\]$/g, "");
  if (!hostname || hostname.endsWith(".") || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || isIP(unwrappedHost)) return "";
  // Push subscriptions are capabilities issued by a small set of browser push
  // services. An allowlist prevents a forged database row from turning this
  // sender into a first-hop SSRF client, including DNS-rebinding tricks.
  if (!supportedPushHost(hostname)) return "";
  const href = endpoint.href;
  return href.length <= 2_048 ? href : "";
}

function normalizeSubscription(row) {
  const endpoint = normalizePushEndpoint(row?.endpoint);
  if (!endpoint) return null;
  try {
    const userPublic = decodeBase64Url(row?.p256dh, [65], "subscription_p256dh");
    const authSecret = decodeBase64Url(row?.auth, [16], "subscription_auth");
    if (userPublic[0] !== 4) return null;
    return { endpoint, userPublic, authSecret };
  } catch {
    return null;
  }
}

function encryptWebPushPayload(plainPayload, subscription) {
  const payload = Buffer.isBuffer(plainPayload) ? plainPayload : Buffer.from(plainPayload);
  if (payload.length > MAX_PLAINTEXT_BYTES) {
    const error = new Error("push_payload_too_large");
    error.code = "push_payload_too_large";
    throw error;
  }

  // RFC 8291 requires a new P-256 ECDH key pair and salt for every message.
  const serverCurve = createECDH("prime256v1");
  serverCurve.generateKeys();
  const serverPublic = serverCurve.getPublicKey(null, "uncompressed");
  const sharedSecret = serverCurve.computeSecret(subscription.userPublic);
  const salt = randomBytes(16);

  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info", "ascii"),
    Buffer.from([0]),
    subscription.userPublic,
    serverPublic,
  ]);
  const keyPrk = hmac(subscription.authSecret, sharedSecret);
  const inputKeyMaterial = hkdfExpand(keyPrk, keyInfo, 32);
  const contentPrk = hmac(salt, inputKeyMaterial);
  const cek = hkdfExpand(
    contentPrk,
    Buffer.concat([Buffer.from("Content-Encoding: aes128gcm", "ascii"), Buffer.from([0])]),
    16,
  );
  const nonce = hkdfExpand(
    contentPrk,
    Buffer.concat([Buffer.from("Content-Encoding: nonce", "ascii"), Buffer.from([0])]),
    12,
  );

  // A single final record has delimiter 0x02 and no padding. AES-GCM appends
  // its 16-byte tag; additional authenticated data is empty per RFC 8188.
  const record = Buffer.concat([payload, Buffer.from([2])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = serverPublic.length;
  return Buffer.concat([header, serverPublic, ciphertext]);
}

function errorCode(error) {
  return String(error?.code || error?.name || "push_error")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 80) || "push_error";
}

async function pruneSubscription(siteSlug, endpoint) {
  const base = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!base || !key) return false;
  const url = new URL(`${base}/rest/v1/${SUBSCRIPTIONS_TABLE}`);
  url.searchParams.set("site_slug", `eq.${siteSlug}`);
  url.searchParams.set("endpoint", `eq.${endpoint}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "return=minimal",
      },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function sendOne(siteSlug, subscription, payloadBytes, vapid) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
  try {
    const body = encryptWebPushPayload(payloadBytes, subscription);
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: vapidAuthorization(subscription.endpoint, vapid),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "300",
      },
      body,
      signal: controller.signal,
    });
    if (response.status === 410) {
      const pruned = await pruneSubscription(siteSlug, subscription.endpoint);
      return { delivered: false, expired: true, pruned, status: 410 };
    }
    if (!response.ok) {
      return { delivered: false, expired: false, pruned: false, status: Number(response.status) || 0 };
    }
    return { delivered: true, expired: false, pruned: false, status: Number(response.status) || 200 };
  } catch (error) {
    return { delivered: false, expired: false, pruned: false, status: 0, code: errorCode(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function logFailure(payload) {
  try { await recordEvent("connect_push_failed", payload); } catch { /* push stays non-fatal */ }
}

/**
 * Send one notification to every retained device for a tenant. This function
 * always resolves with a summary: notification, provider, pruning, and event
 * log failures can never bubble into the lead/chat ingest path.
 */
async function sendConnectPush({ siteSlug, sender, snippet, threadId, kind } = {}) {
  const slug = slugify(siteSlug);
  const visiblePayload = buildConnectPushPayload({ sender, snippet, threadId });
  const safeKind = cleanKind(kind);
  if (!slug) {
    return { ok: false, attempted: 0, sent: 0, pruned: 0, failed: 0, skipped: "invalid_site_slug" };
  }

  let found;
  try {
    found = await select(
      SUBSCRIPTIONS_TABLE,
      `site_slug=eq.${encodeURIComponent(slug)}&limit=${MAX_SUBSCRIPTIONS}`,
    );
  } catch (error) {
    const code = errorCode(error);
    await logFailure({ siteSlug: slug, threadId: visiblePayload.threadId, kind: safeKind, attempted: 0, sent: 0, pruned: 0, failed: 0, code });
    return { ok: false, attempted: 0, sent: 0, pruned: 0, failed: 0, error: code };
  }

  if (!found?.ok) {
    const code = `subscription_read_${Number(found?.status) || "failed"}`;
    await logFailure({ siteSlug: slug, threadId: visiblePayload.threadId, kind: safeKind, attempted: 0, sent: 0, pruned: 0, failed: 0, code });
    return { ok: false, attempted: 0, sent: 0, pruned: 0, failed: 0, error: code };
  }

  const rows = Array.isArray(found.data) ? found.data.slice(0, MAX_SUBSCRIPTIONS) : [];
  if (!rows.length) {
    return { ok: true, attempted: 0, sent: 0, pruned: 0, failed: 0, skipped: "no_subscriptions" };
  }

  let vapid;
  try {
    vapid = readVapidConfig();
  } catch (error) {
    const code = errorCode(error);
    await logFailure({ siteSlug: slug, threadId: visiblePayload.threadId, kind: safeKind, attempted: 0, sent: 0, pruned: 0, failed: rows.length, code });
    return { ok: false, attempted: 0, sent: 0, pruned: 0, failed: rows.length, error: code };
  }

  const payloadBytes = Buffer.from(JSON.stringify(visiblePayload), "utf8");
  const unique = new Map();
  let invalid = 0;
  for (const row of rows) {
    const subscription = normalizeSubscription(row);
    if (!subscription) { invalid += 1; continue; }
    unique.set(subscription.endpoint, subscription);
  }

  const settled = await Promise.all(
    Array.from(unique.values(), (subscription) => sendOne(slug, subscription, payloadBytes, vapid)),
  );
  const sent = settled.filter((result) => result.delivered).length;
  const pruned = settled.filter((result) => result.expired && result.pruned).length;
  const pruneFailed = settled.filter((result) => result.expired && !result.pruned).length;
  const failedResults = settled.filter((result) => !result.delivered && !result.expired);
  const failed = invalid + pruneFailed + failedResults.length;
  const attempted = unique.size;

  if (failed || settled.some((result) => result.expired)) {
    const codes = new Set();
    if (invalid) codes.add("invalid_subscription");
    if (pruneFailed) codes.add("expired_prune_failed");
    for (const result of failedResults) {
      codes.add(result.status ? `http_${result.status}` : (result.code || "push_error"));
    }
    if (pruned) codes.add("http_410_pruned");
    await logFailure({
      siteSlug: slug,
      threadId: visiblePayload.threadId,
      kind: safeKind,
      attempted,
      sent,
      pruned,
      failed,
      codes: Array.from(codes).slice(0, 10),
    });
  }

  return { ok: failed === 0, attempted, sent, pruned, failed };
}

module.exports = {
  buildConnectPushPayload,
  normalizePushEndpoint,
  sendConnectPush,
};
