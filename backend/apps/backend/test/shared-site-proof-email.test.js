"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

const SITE_ID = "11111111-1111-1111-1111-111111111111";
const RELEASE_ID = "22222222-2222-2222-2222-222222222222";
const BUILD_HASH = "a".repeat(64);
const PREVIEW = "https://shared-proof-email.wss-ai.com/";
const CURRENT = "https://shared-proof-email.example/";
const PROSPECT_ID = "shared-proof-email-1";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const REPORT_URL = `https://callprep.wss-ai.com/report/${REPORT_ID}`;
const CERT_SIGNATURE = "f".repeat(64);

function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  global.fetch = originalFetch;
}

afterEach(restoreEnvironment);

function configureEnvironment({ proofEmailV3 = true } = {}) {
  process.env.EMAIL_UNSUB_SECRET = "shared-proof-email-unsubscribe-secret";
  process.env.GHOST_AGENCY_VISUAL_SECRET = "shared-proof-email-visual-secret";
  process.env.GHOST_AGENCY_PUBLIC_URL = "https://ghost.wss-ai.com";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "655 S Main St, Suite 200, Orange, CA 92868";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@wss-ai.com";
  process.env.GHOST_AGENCY_SENDER_NAME = "Mark Woodward";
  process.env.GHOST_AGENCY_PROOF_EMAIL_V3 = proofEmailV3 ? "true" : "false";
  process.env.GHOST_AGENCY_EMAIL_V2 = "false";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  global.fetch = async () => {
    throw new Error("a dry-run proof email must not reach the network");
  };
}

function completeShots(overrides = {}) {
  return {
    old_captured_url: CURRENT,
    old_shot_sha: "b".repeat(64),
    new_captured_url: PREVIEW,
    new_shot_sha: "c".repeat(64),
    old_mobile_captured_url: CURRENT,
    old_mobile_shot_sha: "d".repeat(64),
    new_mobile_captured_url: PREVIEW,
    new_mobile_shot_sha: "e".repeat(64),
    build_hash: BUILD_HASH,
    ...overrides,
  };
}

function prospect(proofShots) {
  return {
    prospect_id: PROSPECT_ID,
    business_name: "Shared Proof Email",
    city: "Irvine",
    industry: "roofing",
    email: "owner@shared-proof-email.example",
    preview_url: PREVIEW,
    current_website: CURRENT,
    before_shot_source_url: CURRENT,
    proof_shots: proofShots,
  };
}

async function compose(proofShots, options) {
  return composeProspect(prospect(proofShots), options);
}

async function composeProspect(input, options) {
  configureEnvironment(options);
  const { sendSequenceStep } = require("../lib/email");
  return sendSequenceStep({
    prospect: input,
    sequence: 1,
    step: 1,
    dryRun: true,
  });
}

function proofUrls(html) {
  const decoded = String(html || "").replace(/&amp;/g, "&");
  const found = decoded.match(/https:\/\/ghost\.wss-ai\.com\/api\/media\/preview-shot\?[^\s"'<>]+/g) || [];
  return [...new Set(found)].map((value) => new URL(value));
}

function urlForKind(urls, kind) {
  return urls.find((url) => url.searchParams.get("v") === kind);
}

function visibleText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function ownerProofProspect({ provenMarket, admissionScope = "owner_only_practice" }) {
  const marketProvenance = provenMarket
    ? { class: "verified", source: "first_party_website" }
    : { class: "provisional", source: "operator_requested_market" };
  const tradeProvenance = provenMarket
    ? { provenance_class: "verified", basis: "first_party_website" }
    : { provenance_class: "provisional", basis: "operator_requested_trade" };
  const certification = {
    signature: CERT_SIGNATURE,
    identity: {
      business_name: "Shared Proof Email",
      canonical_domain: "shared-proof-email.example",
      city: "Spokane",
      state: "WA",
      category: "Plumbing",
    },
  };
  const buildReady = {
    identity_provisional: false,
    provenance: {
      business_name: { class: "verified", source: "first_party_website" },
      canonical_domain: { class: "verified", source: "first_party_website" },
      city: marketProvenance,
      industry: provenMarket
        ? { class: "category", corroboration: "independent_corroborated" }
        : { class: "provisional", method: "operator_requested_provisional" },
    },
    trade_corroboration: tradeProvenance,
  };
  if (admissionScope) buildReady.admission_scope = admissionScope;

  return {
    ...prospect(completeShots({ site_id: SITE_ID, release_id: RELEASE_ID })),
    city: "Spokane",
    state: "WA",
    industry: "Plumbing",
    owner_email: "owner@shared-proof-email.example",
    ownerEmail: "owner@shared-proof-email.example",
    report_url: REPORT_URL,
    truth_packet: {
      intakeGenie: {
        facts: {
          business_name: "Shared Proof Email",
          city: "Spokane",
          state: "WA",
          category: "Plumbing",
          services: ["Plumbing"],
        },
        assets: [],
        evidence: [],
      },
    },
    record: {
      genie_content_certification: certification,
      genie_canonical_packet: {},
      build_ready: buildReady,
    },
  };
}

function ownerProofReport() {
  return {
    data: {
      id: REPORT_ID,
      business_name: "Shared Proof Email",
      business_url: CURRENT,
      overall_grade: null,
      overall_score: 0,
      data_availability: { gbp: false, social: false, website: true },
      source_snapshot: {
        packet_id: `wss-genie-cert-v1:${CERT_SIGNATURE}`,
        business_name: "Shared Proof Email",
        city: "Spokane",
        state: "WA",
        industry: "Plumbing",
        categories: {},
      },
    },
  };
}

async function composeOwnerProof({ provenMarket, admissionScope = "owner_only_practice" }) {
  configureEnvironment({ proofEmailV3: false });
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@shared-proof-email.example";
  process.env.CALLPREP_SUPABASE_URL = "https://shared-proof-email.supabase.co";
  process.env.CALLPREP_SUPABASE_ANON_KEY = "shared-proof-email-anon-key";
  require("../lib/report-grade").clearReportGradeCache();
  global.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify(ownerProofReport()),
  });

  const { sendSequenceStep } = require("../lib/email");
  return sendSequenceStep({
    prospect: ownerProofProspect({ provenMarket, admissionScope }),
    sequence: 1,
    step: 1,
    dryRun: true,
    internalOwnerProof: true,
    lineBatchApproved: true,
    allowContactHoldBypass: true,
    requireSignalReportInEmail: true,
    sourceRecipientEmail: "prospect@shared-proof-email.example",
    verifyOwnerPracticeReceipt: (_prospect, record) => ({
      ok: true,
      receipt: record.genie_content_certification,
    }),
  });
}

async function ownerProofProviderBoundaryMarketChange() {
  const emailPath = require.resolve("../lib/email");
  const storePath = require.resolve("../lib/store");
  const priorEmail = require.cache[emailPath];
  const priorStore = require.cache[storePath];
  const providerBodies = [];
  let canonicalReads = 0;

  configureEnvironment({ proofEmailV3: false });
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@shared-proof-email.example";
  process.env.GHOST_AGENCY_OUTREACH_FROM = "WSS Labs <hello@go.wss-ai.com>";
  process.env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET = "shared-proof-email-webhook-secret";
  process.env.GHOST_AGENCY_PROSPECT_SEND_ENABLED = "true";
  process.env.RESEND_API_KEY = "shared-proof-email-resend-key";
  process.env.CALLPREP_SUPABASE_URL = "https://shared-proof-email.supabase.co";
  process.env.CALLPREP_SUPABASE_ANON_KEY = "shared-proof-email-anon-key";
  require("../lib/report-grade").clearReportGradeCache();

  const initial = ownerProofProspect({ provenMarket: true });
  const canonical = ownerProofProspect({ provenMarket: false });
  canonical.record.report_url = REPORT_URL;
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      recordEvent: async () => ({ ok: true }),
      upsertRow: async () => ({ ok: true }),
      select: async (table) => {
        if (table === "ghost_agency_prospects") {
          canonicalReads += 1;
          return { ok: true, data: [canonical] };
        }
        return { ok: true, data: [] };
      },
    },
  };
  delete require.cache[emailPath];
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("/functions/v1/get-business-report")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(ownerProofReport()),
      };
    }
    providerBodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ id: "unexpected-provider-call" }) };
  };

  try {
    const { sendSequenceStep } = require("../lib/email");
    const result = await sendSequenceStep({
      prospect: initial,
      sequence: 1,
      step: 1,
      dryRun: false,
      internalOwnerProof: true,
      lineBatchApproved: true,
      allowContactHoldBypass: true,
      requireSignalReportInEmail: true,
      sourceRecipientEmail: "prospect@shared-proof-email.example",
      verifyOwnerPracticeReceipt: (_prospect, record) => ({
        ok: true,
        receipt: record.genie_content_certification,
      }),
    });
    return { result, providerBodies, canonicalReads };
  } finally {
    delete require.cache[emailPath];
    delete require.cache[storePath];
    require("../lib/report-grade").clearReportGradeCache();
    if (priorEmail) require.cache[emailPath] = priorEmail;
    if (priorStore) require.cache[storePath] = priorStore;
  }
}

test("shared-release email signs the complete tuple into new visuals only", async () => {
  const shots = completeShots({ site_id: SITE_ID, release_id: RELEASE_ID });
  const desktop = await compose(shots, { proofEmailV3: false });
  const mobile = await compose(shots, { proofEmailV3: true });
  assert.equal(desktop.ok, true, JSON.stringify(desktop));
  assert.equal(mobile.ok, true, JSON.stringify(mobile));

  const urls = [...proofUrls(desktop.htmlPreview), ...proofUrls(mobile.htmlPreview)];
  const { verifySignedVisualRequest } = require("../lib/preview-visuals");
  for (const kind of ["new", "new-mobile"]) {
    const url = urlForKind(urls, kind);
    assert.ok(url, `${kind} visual was not rendered`);
    const verified = verifySignedVisualRequest(Object.fromEntries(url.searchParams.entries()));
    assert.equal(verified.ok, true);
    assert.equal(verified.legacy, false);
    assert.deepEqual(
      {
        site_id: verified.proofIdentity.site_id,
        release_id: verified.proofIdentity.release_id,
        build_hash: verified.proofIdentity.build_hash,
      },
      { site_id: SITE_ID, release_id: RELEASE_ID, build_hash: BUILD_HASH },
    );
  }

  for (const kind of ["old", "old-mobile"]) {
    const url = urlForKind(urls, kind);
    assert.ok(url, `${kind} visual was not rendered`);
    assert.equal(url.searchParams.has("si"), false);
    assert.equal(url.searchParams.has("ri"), false);
    assert.equal(url.searchParams.has("bh"), false);
    assert.equal(
      verifySignedVisualRequest(Object.fromEntries(url.searchParams.entries())).legacy,
      true,
    );
  }
});

test("shared-release email never prefers an unbound legacy animation over its verified still", async () => {
  const result = await compose(completeShots({
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    anim_sha: "f".repeat(64),
    anim_bytes: 1234,
    anim_lane: "hero",
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
  const urls = proofUrls(result.htmlPreview);
  assert.ok(
    urlForKind(urls, "new") || urlForKind(urls, "new-mobile"),
    "the tuple-bound shared still remains available",
  );
  assert.equal(urlForKind(urls, "gif"), undefined, "an unbound legacy GIF may not replace shared proof");
});

test("partial or malformed direct-send tuples refuse before any visual is minted", async () => {
  const invalidTuples = [
    [{ site_id: SITE_ID }, /^shared_proof_identity_incomplete:/],
    [{ release_id: RELEASE_ID }, /^shared_proof_identity_incomplete:/],
    [{ site_id: SITE_ID, release_id: RELEASE_ID, build_hash: "short" }, /^shared_proof_identity_malformed:build_hash:/],
    [{ site_id: "not-a-uuid", release_id: RELEASE_ID }, /^shared_proof_identity_malformed:site_id:/],
    [{ site_id: SITE_ID, release_id: RELEASE_ID, build_hash: BUILD_HASH.toUpperCase() }, /^shared_proof_identity_malformed:build_hash:/],
  ];

  for (const [tuple, reasonRe] of invalidTuples) {
    const result = await compose(completeShots(tuple));
    assert.equal(result.ok, false, JSON.stringify({ tuple, result }));
    assert.match(String(result.blocked || ""), reasonRe, JSON.stringify({ tuple, result }));
    assert.equal(result.htmlPreview, undefined);
  }
});

test("direct send refuses conflicting tuple sources before minting", async () => {
  const input = prospect(completeShots({ site_id: SITE_ID, release_id: RELEASE_ID }));
  input.record = {
    proof_shots: completeShots({
      site_id: SITE_ID,
      release_id: "33333333-3333-3333-3333-333333333333",
    }),
  };
  const result = await composeProspect(input);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(String(result.blocked || ""), /^shared_proof_identity_conflict:/);
  assert.equal(result.htmlPreview, undefined);
});

test("an active direct-send tuple cannot launder a legacy-only proof record", async () => {
  const input = prospect(completeShots());
  input.proofIdentity = {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
  };
  const result = await composeProspect(input);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.blocked, "shared_proof_evidence_missing");
  assert.equal(result.htmlPreview, undefined);
});

test("shared direct send ignores an earlier legacy record and selects the exact tuple match", async () => {
  const legacy = completeShots({
    new_captured_url: "https://legacy-first.wss-ai.com/",
    new_shot_sha: "f".repeat(64),
  });
  const shared = completeShots({ site_id: SITE_ID, release_id: RELEASE_ID });
  const input = prospect(legacy);
  input.record = { proof_shots: shared };

  const result = await composeProspect(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  const urls = proofUrls(result.htmlPreview);
  const newUrl = urlForKind(urls, "new") || urlForKind(urls, "new-mobile");
  assert.ok(newUrl, "the exact shared record supplies the after visual");
  const { verifySignedVisualRequest } = require("../lib/preview-visuals");
  const verified = verifySignedVisualRequest(Object.fromEntries(newUrl.searchParams.entries()));
  assert.equal(verified.ok, true);
  assert.equal(verified.legacy, false);
  assert.deepEqual(
    {
      site_id: verified.proofIdentity.site_id,
      release_id: verified.proofIdentity.release_id,
      build_hash: verified.proofIdentity.build_hash,
    },
    { site_id: SITE_ID, release_id: RELEASE_ID, build_hash: BUILD_HASH },
  );
  assert.doesNotMatch(result.htmlPreview, /legacy-first/);
});

test("shared direct send chooses a complete exact-tuple record over an earlier partial match", async () => {
  const partial = {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    new_captured_url: PREVIEW,
  };
  const complete = completeShots({ site_id: SITE_ID, release_id: RELEASE_ID });
  const input = prospect(partial);
  input.record = { proof_shots: complete };

  const result = await composeProspect(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  const urls = proofUrls(result.htmlPreview);
  assert.ok(urlForKind(urls, "new") || urlForKind(urls, "new-mobile"));
});

test("a tuple-bound capture identity refusal outranks older complete proof", async () => {
  const complete = completeShots({ site_id: SITE_ID, release_id: RELEASE_ID });
  const refused = {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    new_captured_url: PREVIEW,
    new_shot_sha: "c".repeat(64),
    before_refused: "capture_identity_capture_domain_mismatch",
  };
  const input = prospect(complete);
  input.captured = { shots: refused };

  const result = await composeProspect(input);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.blocked, "no_before_after_visuals");
  assert.equal(result.htmlPreview, undefined);
});

test("shared proof refuses a digest-only after instead of minting a false visual", async () => {
  const result = await compose(completeShots({
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    new_captured_url: "",
  }));
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.blocked, "no_before_after_visuals");
  assert.equal(result.htmlPreview, undefined, "a refused send may not expose a minted visual URL");
});

test("shared proof refuses an after URL without its recorded pixel digest", async () => {
  const result = await compose(completeShots({
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    new_shot_sha: "",
  }));
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.blocked, "no_before_after_visuals");
  assert.equal(result.htmlPreview, undefined);
});

test("shared proof refuses an after captured on a different host", async () => {
  const result = await compose(completeShots({
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    new_captured_url: "https://somebody-elses-preview.wss-ai.com/",
  }));
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.blocked, "no_before_after_visuals");
  assert.equal(result.htmlPreview, undefined);
});

test("shared mobile visual also requires both its digest and own-host capture URL", async () => {
  const result = await compose(completeShots({
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    new_mobile_captured_url: "",
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
  const urls = proofUrls(result.htmlPreview);
  assert.ok(urlForKind(urls, "new"), "complete desktop proof still renders");
  assert.equal(urlForKind(urls, "new-mobile"), undefined, "partial mobile proof mints no visual");
});

test("an explicit before-capture identity refusal cannot be overridden by stale top-level proof data", async () => {
  const result = await compose(completeShots({
    before_refused: "capture_identity_capture_domain_mismatch",
  }));
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.blocked, "no_before_after_visuals");
  assert.equal(result.htmlPreview, undefined, "a refused identity capture may not mint an old visual");
});

test("build_hash-only legacy proof records keep the exact legacy visual URLs", async () => {
  const shots = completeShots();
  const desktop = await compose(shots, { proofEmailV3: false });
  const mobile = await compose(shots, { proofEmailV3: true });
  assert.equal(desktop.ok, true, JSON.stringify(desktop));
  assert.equal(mobile.ok, true, JSON.stringify(mobile));

  const urls = [...proofUrls(desktop.htmlPreview), ...proofUrls(mobile.htmlPreview)];
  const { signedVisualPath } = require("../lib/preview-visuals");
  const { assembleShotUrl } = require("../lib/email");
  for (const [kind, sha] of [
    ["old", shots.old_shot_sha],
    ["new", shots.new_shot_sha],
    ["old-mobile", shots.old_mobile_shot_sha],
    ["new-mobile", shots.new_mobile_shot_sha],
  ]) {
    const url = urlForKind(urls, kind);
    assert.ok(url, `${kind} visual was not rendered`);
    const legacyPath = signedVisualPath({
      kind,
      previewUrl: PREVIEW,
      currentWebsite: CURRENT,
      nonce: PROSPECT_ID,
    });
    assert.equal(
      url.toString(),
      assembleShotUrl("https://ghost.wss-ai.com", legacyPath, sha),
    );
    assert.equal(url.searchParams.has("si"), false);
    assert.equal(url.searchParams.has("ri"), false);
    assert.equal(url.searchParams.has("bh"), false);
  }
});

test("build_hash-only legacy proof keeps its exact animation URL", async () => {
  const shots = completeShots({
    anim_sha: "f".repeat(64),
    anim_bytes: 1234,
    anim_lane: "hero",
  });
  const result = await compose(shots);
  assert.equal(result.ok, true, JSON.stringify(result));
  const gif = urlForKind(proofUrls(result.htmlPreview), "gif");
  assert.ok(gif, "legacy motion still renders");

  const { signedVisualPath } = require("../lib/preview-visuals");
  const { assembleShotUrl } = require("../lib/email");
  const legacyPath = signedVisualPath({
    kind: "gif",
    previewUrl: PREVIEW,
    currentWebsite: CURRENT,
    nonce: PROSPECT_ID,
  });
  assert.equal(
    gif.toString(),
    assembleShotUrl("https://ghost.wss-ai.com", legacyPath, shots.anim_sha),
  );
});

test("owner-only Practice does not present requested market or trade as verified local proof", async () => {
  const result = await composeOwnerProof({ provenMarket: false });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.ownerProof, true);

  const html = visibleText(result.htmlPreview);
  const text = String(result.composedText || "");
  for (const body of [html, text]) {
    assert.doesNotMatch(body, /scan local businesses around Spokane/i);
    assert.doesNotMatch(body, /checked the local competition around Spokane/i);
    assert.doesNotMatch(body, /measuring your local market/i);
    assert.doesNotMatch(body, /local competitors ranked/i);
    assert.doesNotMatch(body, /local businesses like yours/i);
    assert.doesNotMatch(body, /in your area/i);
    assert.doesNotMatch(body, /plumbing Spokane/i);
  }
  assert.doesNotMatch(String(result.subject || ""), /Spokane|Plumbing/i);

  assert.match(html, /YOU WERE PICKED/i);
  assert.match(html, /we already built your new website/i);
  assert.match(html, /OPEN YOUR LIVE PREVIEW/i);
});

test("owner proof keeps the August 21 shell and local copy when market provenance is proven", async () => {
  const result = await composeOwnerProof({ provenMarket: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.ownerProof, true);

  const html = visibleText(result.htmlPreview);
  const text = String(result.composedText || "");
  for (const body of [html, text]) {
    assert.match(body, /scan local businesses around Spokane/i);
    assert.match(body, /measuring your local market/i);
  }

  assert.match(html, /YOU WERE PICKED/i);
  assert.match(html, /we already built your new website/i);
  assert.match(html, /OPEN YOUR LIVE PREVIEW/i);
});

test("provisional city metadata without durable Practice admission cannot switch owner-proof copy", async () => {
  const result = await composeOwnerProof({ provenMarket: false, admissionScope: "" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.ownerProof, true);

  const html = visibleText(result.htmlPreview);
  const text = String(result.composedText || "");
  for (const body of [html, text]) {
    assert.match(body, /scan local businesses around Spokane/i);
    assert.match(body, /measuring your local market/i);
  }
});

test("owner Practice blocks before provider when canonical market provenance changes after composition", async () => {
  const { result, providerBodies, canonicalReads } = await ownerProofProviderBoundaryMarketChange();

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.blocked, "owner_proof_market_provenance_changed");
  assert.equal(result.retryableBeforeProvider, true);
  assert.equal(result.providerAttempted, false);
  assert.equal(canonicalReads, 1, "the regression did not reach the canonical provider-boundary read");
  assert.equal(providerBodies.length, 0, "market-truth drift must block before Resend");
});
