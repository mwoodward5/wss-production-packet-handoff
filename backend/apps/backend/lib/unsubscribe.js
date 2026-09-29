"use strict";

const crypto = require("node:crypto");
const { publicConfig } = require("./registry");

function base64url(value) {
  return Buffer.from(String(value)).toString("base64url");
}

function fromBase64url(value) {
  return Buffer.from(String(value), "base64url").toString("utf8");
}

function signingSecret() {
  return process.env.EMAIL_UNSUB_SECRET?.trim() || "";
}

function sign(payload) {
  const secret = signingSecret();
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createUnsubscribeToken(input = {}) {
  const email = String(input.email || input.ownerEmail || input.owner_email || "").trim().toLowerCase();
  const prospectId = String(input.prospectId || input.prospect_id || input.id || "").trim();
  const payload = JSON.stringify({
    email,
    prospectId,
    ts: Date.now(),
  });
  const encoded = base64url(payload);
  const signature = sign(encoded);
  return signature ? `${encoded}.${signature}` : "";
}

function verifyUnsubscribeToken(token) {
  if (!token || !signingSecret()) return { ok: false, error: "token_unavailable" };
  const [encoded, signature] = String(token).split(".");
  if (!encoded || !signature) return { ok: false, error: "token_format_invalid" };
  const expected = sign(encoded);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return { ok: false, error: "token_signature_invalid" };
  }
  try {
    const data = JSON.parse(fromBase64url(encoded));
    return { ok: true, data };
  } catch {
    return { ok: false, error: "token_payload_invalid" };
  }
}

function unsubscribeUrl(input = {}) {
  const token = createUnsubscribeToken(input);
  const base = publicConfig().apiUrl.replace(/\/+$/, "");
  if (!token) return "";
  return `${base}/api/outreach/unsubscribe?t=${encodeURIComponent(token)}`;
}

module.exports = {
  createUnsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
};
