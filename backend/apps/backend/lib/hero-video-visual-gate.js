"use strict";

const { createHmac, timingSafeEqual } = require("node:crypto");

const VISUAL_GATE_SCHEMA = "wss.hero.visual_identity_gate.v1";
const SHA256_RE = /^[a-f0-9]{64}$/;
const MAX_ATTESTATION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function clean(value) { return String(value ?? "").trim(); }

function canonicalVisualGate(receipt, gate = {}) {
  return {
    schema_version: VISUAL_GATE_SCHEMA,
    job_id: clean(receipt?.job_id),
    prospect_id: clean(receipt?.prospect_id),
    generation_revision: Number(receipt?.generation_revision) || 0,
    source_sha256: clean(receipt?.source_sha256).toLowerCase(),
    clip_sha256: clean(receipt?.clip_sha256).toLowerCase(),
    verdict: clean(gate.verdict).toLowerCase(),
    evaluator: clean(gate.evaluator),
    checked_at: clean(gate.checked_at),
  };
}

function serializedGate(value) {
  return Object.keys(value).sort().map((key) => `${key}=${value[key]}`).join("\n");
}

function signVisualGateAttestation(receipt, input, secret) {
  const gate = canonicalVisualGate(receipt, input);
  return {
    ...gate,
    signature: createHmac("sha256", clean(secret)).update(serializedGate(gate)).digest("hex"),
  };
}

function verifyVisualGateReceipt(receipt, options = {}) {
  const secret = clean(options.secret);
  if (secret.length < 32) return { ok: false, reason: "hero_visual_gate_secret_required" };
  const raw = receipt?.visual_gate;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "hero_visual_gate_attestation_required" };
  }
  const gate = canonicalVisualGate(receipt, raw);
  const checkedAt = Date.parse(gate.checked_at);
  const now = Number(options.nowMs?.() ?? Date.now());
  if (
    raw.schema_version !== VISUAL_GATE_SCHEMA
    || gate.verdict !== "passed"
    || !/^[a-zA-Z0-9][a-zA-Z0-9 ._:@/-]{0,119}$/.test(gate.evaluator)
    || !gate.job_id
    || !gate.prospect_id
    || !Number.isInteger(gate.generation_revision)
    || gate.generation_revision < 1
    || !SHA256_RE.test(gate.source_sha256)
    || !SHA256_RE.test(gate.clip_sha256)
    || !Number.isFinite(checkedAt)
    || checkedAt > now + 60_000
    || now - checkedAt > MAX_ATTESTATION_AGE_MS
  ) return { ok: false, reason: "hero_visual_gate_attestation_invalid" };
  const expected = createHmac("sha256", secret).update(serializedGate(gate)).digest();
  let actual;
  try { actual = Buffer.from(clean(raw.signature), "hex"); } catch { actual = Buffer.alloc(0); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "hero_visual_gate_signature_invalid" };
  }
  return { ok: true, gate };
}

module.exports = {
  MAX_ATTESTATION_AGE_MS,
  VISUAL_GATE_SCHEMA,
  canonicalVisualGate,
  signVisualGateAttestation,
  verifyVisualGateReceipt,
};
