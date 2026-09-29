"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { afterEach, test } = require("node:test");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function restoreEnvironment() {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

function responseCapture() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    end(value = "") { this.body = value; },
  };
}

function svixRequest(body, secretBytes, options = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const id = options.id || "msg_resend_contract";
  const timestamp = String(options.timestamp || Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${raw}`)
    .digest("base64");
  return {
    method: "POST",
    body: Buffer.from(raw, "utf8"),
    headers: {
      ...(options.headers || {}),
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1, ${signature}`,
    },
  };
}

function okJson(json = []) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => json,
  };
}

afterEach(restoreEnvironment);

test("live email sends fail closed when suppression cannot be checked", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({ message: "unavailable" }) });

  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect: { id: "prospect-1", email: "owner@example.com" },
    dryRun: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocked, "suppression_check_unavailable");
});

// PROOF-FIRST INVERSION (owner directive 2026-07-30, Flint audit 2026-07-31).
//
// This test used to assert that a stale preview belonging to a DIFFERENT
// business was silently dropped from the template and the email went out
// anyway. That was the consent-first contract, where the preview was
// decoration. It is no longer true and must not be: proof-first makes the
// preview the entire proposition ("here is the site we built for YOU"), so a
// preview we cannot bind to this prospect is the email being wrong about who
// it is addressed to — the same defect class as attaching a screenshot of
// somebody else's website. Dropping it and sending anyway would ship an email
// whose whole point is missing AND normalise "the artifact didn't match, carry
// on". The refusal below is a STRENGTHENING of this assertion, not a
// relaxation: ignore -> hard refuse.
test("consent-first outreach ignores a stale preview from a different business", async () => {
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@example.test";
  const { sendSequenceStep } = require("../lib/email");
  const mismatch = await sendSequenceStep({
    prospect: {
      prospect_id: "lead-mismatch",
      business_name: "Howie Excavating",
      email: "owner@example.test",
      city: "Irvine",
      industry: "landscaping",
      current_website: "https://howie-excavating.example/",
      before_shot_source_url: "https://howie-excavating.example/",
      report_url: "https://callprep.wss-ai.com/report/audit/ready?artifact=scorecard.json",
      // Another business's slug, and nothing in the record binds it to Howie.
      preview_url: "https://preview.wss-ai.com/try/signature-landscape/",
      siteforge_renderer: "05-build-v8",
      siteforge_qc_passed: true,
      siteforge_visual_qc_passed: true,
      siteforge_qc_contract: "public-surface-v2",
    },
    sequence: 1,
    step: 1,
    dryRun: true,
  });

  // HARD REFUSAL — and for the preview-identity reason specifically, not as a
  // side effect of some other missing artifact.
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.blocked, "preview_identity_prospect_mismatch");
  assert.match(mismatch.message, /belong to this prospect/i);
  // Nothing was RENDERED, so the other business's slug cannot leak into an
  // email — the property the original assertion protected by scrubbing, now
  // guaranteed by construction. The internal detail names the offending slug on
  // purpose: an operator has to be told which preview was rejected and why.
  assert.equal(mismatch.htmlPreview, undefined);
  assert.equal(mismatch.bodyPreview, undefined);
  assert.equal(mismatch.subject, undefined);
  assert.equal(mismatch.detail.slug, "signature-landscape");
});

// The same refusal when the evidence is present but names somebody else — the
// case that must never degrade into "well, the flags were green".
test("a preview whose release evidence names another business is refused outright", async () => {
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@example.test";
  const { sendSequenceStep } = require("../lib/email");
  const wrongOwner = await sendSequenceStep({
    prospect: {
      prospect_id: "lead-wrong-owner",
      business_name: "Howie Excavating",
      email: "owner@example.test",
      city: "Irvine",
      industry: "landscaping",
      current_website: "https://howie-excavating.example/",
      before_shot_source_url: "https://howie-excavating.example/",
      preview_url: "https://preview.wss-ai.com/try/signature-landscape/",
      siteforge_renderer: "05-build-v8",
      siteforge_qc_passed: true,
      siteforge_visual_qc_passed: true,
      siteforge_qc_contract: "public-surface-v2",
      release_evidence: {
        schema: "siteforge-release-evidence-v1",
        identity: {
          verified: true,
          expected: { business_name: "Signature Landscape" },
          actual: { business_name: "Signature Landscape", public_packet_business_name: "Signature Landscape" },
        },
      },
    },
    sequence: 1,
    step: 1,
    dryRun: true,
  });
  assert.equal(wrongOwner.ok, false);
  assert.equal(wrongOwner.blocked, "preview_identity_prospect_mismatch");
  assert.equal(wrongOwner.htmlPreview, undefined);
});

// THE OTHER HALF OF THE SAME CONTRACT. A gate that only ever says no is not a
// gate, it is an outage. This is the case that MUST stay open: a preview whose
// slug is an opaque deployment id — carrying no business name and therefore
// contradicting nothing — bound to this prospect by release evidence that names
// them exactly, describes the current build, and whose own artifacts live under
// that very preview URL.
//
// Fixture note (2026-07-31): current_website + before_shot_source_url were
// added because "stays open" now means the proof artifacts are actually
// present and attributable. The before-image content check fails closed on an
// unrecorded capture source, so a fixture with no website is no longer a
// sendable prospect in any lane. That is the strengthened contract, supplied —
// not an assertion relaxed.
test("outreach compose allows deterministic-missing preview identity and stays open", async () => {
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@example.test";
  const { sendSequenceStep } = require("../lib/email");
  const generationFingerprint = "howie-excavating-composition-v8";
  const releaseEvidence = {
    schema: "siteforge-release-evidence-v1",
    map: {
      verified: true,
      qc_check: { name: "release-map-evidence", detail: "verified" },
      artifact: "screenshots/desktop/map.png",
      evidence_artifact: "screenshots/map-evidence.json",
      manifest_artifact: "screenshots/manifest.json",
      screenshot: { size: 4096, sha256: "c".repeat(64) },
      runtime: {
        response_ok: true,
        geometry_ok: true,
        pixels_ok: true,
        unique_colors: 32,
        variance: 120,
      },
      manifest: { schema: "siteforge-screenshot-manifest-v1", map_pass: true },
      supporting_checks: [
        { name: "visual-satellite-map-evidence", pass: true, detail: "verified" },
        { name: "visual-address-map-directions", pass: true, detail: "verified" },
      ],
      screenshot_url: "https://preview.wss-ai.com/try/Tnas3b5iJUmCsw/screenshots/desktop/map.png",
    },
    identity: {
      verified: true,
      qc_check: { name: "release-business-identity-match", detail: "matched" },
      expected: { business_name: "Howie Excavating" },
      actual: {
        business_name: "Howie Excavating",
        public_packet_business_name: "Howie Excavating",
        local_business_nodes: 1,
      },
      public_packet_url: "https://preview.wss-ai.com/try/Tnas3b5iJUmCsw/packet.json",
    },
    template_family: {
      verified: true,
      qc_check: { name: "release-template-family-match", detail: "matched" },
      expected: { family: "excavation-map-led" },
      actual: { family: "excavation-map-led" },
      public_packet_url: "https://preview.wss-ai.com/try/Tnas3b5iJUmCsw/packet.json",
    },
  };
  const open = await sendSequenceStep({
    prospect: {
      prospect_id: "lead-open",
      business_name: "Howie Excavating",
      email: "owner@example.test",
      city: "Irvine",
      industry: "landscaping",
      current_website: "https://howie-excavating.example/",
      // Where the "before" capture actually landed. Same registrable domain as
      // current_website, so the shot is provably a picture of THEIR site.
      before_shot_source_url: "https://www.howie-excavating.example/home",
      report_url: "https://callprep.wss-ai.com/report/audit/ready?artifact=scorecard.json",
      preview_url: "https://preview.wss-ai.com/try/Tnas3b5iJUmCsw/",
      siteforge_renderer: "05-build-v8",
      siteforge_generation_fingerprint: generationFingerprint,
      siteforge_qc_passed: true,
      siteforge_visual_qc_passed: true,
      siteforge_qc_contract: "public-surface-v2",
      release_evidence: releaseEvidence,
      truth_packet: {
        intakeGenie: {
          generation_fingerprint: generationFingerprint,
          release_evidence: releaseEvidence,
        },
      },
    },
    sequence: 1,
    step: 1,
    dryRun: true,
  });
  assert.equal(open.ok, true);
  assert.equal(open.blocked, undefined);
});

test("legacy Vapi webhook rejects missing and invalid verification before storage", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.VAPI_WEBHOOK_SECRET;
  let fetches = 0;
  global.fetch = async () => { fetches += 1; throw new Error("unexpected fetch"); };
  const handler = require("../api/webhooks/vapi");

  const missing = responseCapture();
  await handler({ method: "POST", headers: {}, body: { type: "test" } }, missing);
  assert.equal(missing.statusCode, 503);
  assert.equal(JSON.parse(missing.body).error, "vapi_webhook_not_configured");

  process.env.VAPI_WEBHOOK_SECRET = "webhook-test";
  const invalid = responseCapture();
  await handler({ method: "POST", headers: { "x-vapi-secret": "wrong" }, body: { type: "test" } }, invalid);
  assert.equal(invalid.statusCode, 401);
  assert.equal(fetches, 0);

  const valid = responseCapture();
  await handler({ method: "POST", headers: { "x-vapi-secret": "webhook-test" }, body: { type: "test" } }, valid);
  assert.equal(valid.statusCode, 200);
  assert.equal(JSON.parse(valid.body).ok, true);
  assert.equal(fetches, 0);
});

test("billing return URLs stay on trusted AnswerCrew origins", () => {
  process.env.MISSION_CONTROL_PUBLIC_URL = "https://missioncontrol.wss-ai.com";
  const { checkoutSuccessUrl, safePortalReturnUrl } = require("../lib/mission-control-commerce");

  assert.equal(safePortalReturnUrl("https://attacker.example/phish"), "https://missioncontrol.wss-ai.com/billing");
  assert.equal(safePortalReturnUrl("https://getanswercrew.com/account"), "https://getanswercrew.com/account");
  assert.match(checkoutSuccessUrl("https://missioncontrol.wss-ai.com/billing/success", "solo"), /session_id=\{CHECKOUT_SESSION_ID\}/);
  assert.match(checkoutSuccessUrl("https://missioncontrol.wss-ai.com/billing/success", "solo"), /plan=solo/);
});

test("launch readiness includes the durable outreach delivery pause", () => {
  const source = require("node:fs").readFileSync(require.resolve("../api/admin/readiness"), "utf8");
  assert.match(source, /deliveryPauseStatus/);
  assert.match(source, /Cold outreach delivery pause is active/);
  assert.match(source, /deliveryPause,/);
});

test("Resend accepts raw Svix signatures from inherited headers and writes plural suppressions", async () => {
  const secretBytes = Buffer.from("resend-contract-secret");
  process.env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET = `whsec_${secretBytes.toString("base64")}`;
  delete process.env.RESEND_WEBHOOK_SECRET;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  const writes = [];
  global.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    if (init.method === "POST") writes.push({ table: parsed.pathname.split("/").pop(), body: JSON.parse(init.body) });
    return okJson([]);
  };
  const handler = require("../api/webhooks/resend");
  const response = responseCapture();
  await handler(svixRequest({
    type: "email.complained",
    data: { email_id: "re_contract", to: ["Owner@Example.test"] },
  }, secretBytes, { headers: { "x-inherited-header": "kept" } }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).received, true);
  const suppression = writes.find((write) => write.table === "ghost_agency_suppressions");
  assert.deepEqual(suppression.body, {
    suppression_key: "owner@example.test",
    email: "owner@example.test",
    prospect_id: null,
    reason: "complaint",
    source: "resend_webhook",
    payload: { type: "email.complained", email_id: "re_contract", runId: null },
    updated_at: suppression.body.updated_at,
  });
  assert.ok(writes.some((write) => write.table === "ghost_agency_events"));
});

test("Resend invalid Svix signatures return before any storage writes", async () => {
  const secretBytes = Buffer.from("resend-contract-secret");
  process.env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET = `whsec_${secretBytes.toString("base64")}`;
  let writes = 0;
  global.fetch = async () => { writes += 1; throw new Error("invalid signature must not write"); };
  const handler = require("../api/webhooks/resend");
  const request = svixRequest({ type: "email.complained", data: { to: ["owner@example.test"] } }, secretBytes);
  request.headers["svix-signature"] = "v1, wrong";
  const response = responseCapture();
  await handler(request, response);

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, "svix_signature_invalid");
  assert.equal(writes, 0);
});

test("Resend stale Svix signatures return before any storage writes", async () => {
  const secretBytes = Buffer.from("resend-contract-secret");
  process.env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET = `whsec_${secretBytes.toString("base64")}`;
  let writes = 0;
  global.fetch = async () => { writes += 1; throw new Error("stale signature must not write"); };
  const handler = require("../api/webhooks/resend");
  const response = responseCapture();
  await handler(svixRequest({ type: "email.delivered", data: {} }, secretBytes, {
    timestamp: Math.floor(Date.now() / 1000) - 301,
  }), response);

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, "svix_timestamp_stale");
  assert.equal(writes, 0);
});

test("Resend accepts the RESEND_WEBHOOK_SECRET alias", async () => {
  const secretBytes = Buffer.from("resend-alias-secret");
  delete process.env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET;
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${secretBytes.toString("base64")}`;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  global.fetch = async () => okJson([]);
  const handler = require("../api/webhooks/resend");
  const response = responseCapture();
  await handler(svixRequest({ type: "email.delivered", data: {} }, secretBytes), response);

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).received, true);
});
