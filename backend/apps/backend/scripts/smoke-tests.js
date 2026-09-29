"use strict";

const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

delete process.env.GOOGLE_PLACES_API_KEY;
// The smoke gate must never be able to spend live discovery credits, even on
// a machine with a real key exported and a path that falls through to fetch.
delete process.env.FIRECRAWL_API_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.GHOST_AGENCY_SITEFORGE_BUILD_URL;
process.env.INTAKE_GENIE_BASE_URL = "https://intake.example.test";
process.env.INTAKE_GENIE_TOKEN = "intake-test-token";

process.env.PUBLIC_APP_URL = "https://example.test";
process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
process.env.EMAIL_UNSUB_SECRET = "test-secret";
process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@example.test";
process.env.GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN = "callback-test";
process.env.GHOST_AGENCY_RESEND_FROM = "WSS Labs <hello@wss-ai.com>";
process.env.GHOST_AGENCY_OUTREACH_FROM = "WSS Labs <hello@go.wss-ai.com>";
process.env.GHOST_AGENCY_OUTREACH_CC = "woodwardsoftware@gmail.com";
process.env.GHOST_AGENCY_API_URL = "https://ghost.example.com";
process.env.GHOST_AGENCY_CHECKOUT_LINK_SECRET = "checkout-link-test-secret";

const nativeFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  if (String(url) === "https://intake.example.test/healthz") {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (String(url).startsWith("https://intake.example.test/api/intake-genie/compile")) {
    const body = JSON.parse(options.body || "{}");
    const hints = body.prospect_hints || {};
    return new Response(JSON.stringify({
      ok: true,
      version: "intake-genie-v2",
      status: "complete",
      facts: {
        name: hints.name,
        city: hints.city,
        state: hints.state,
        category: hints.category,
        latlng: body.latlng || null,
        services: ["Drain cleaning", "Water heater repair"],
      },
      evidence: [{ field: "name", value: hints.name, confidence: 0.9, source_type: "website" }],
      assets: [], trust: {}, optimization: { target_queries: ["plumbing phoenix az"] }, cache: { hits: 0, misses: 1 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return nativeFetch(url, options);
};

const { parseDeterministic } = require("../lib/copilot");
const { buildBusinessTruthPacket, businessTruthFromProspect, GOLDILOCKS } = require("../lib/business-truth");
const { mineLeads, extractEmail, prospectIdForPlace, scorePlace } = require("../lib/lead-miner");
const { prospectFromRow } = require("../lib/prospects");
const { emailFrom, outreachFromStatus } = require("../lib/env-compat");
const { normalizeUsLocation, publicServiceNames } = require("../lib/public-data");
const { oneClickUnsubscribeHeaders, sendResendEmail, sendSequenceStep } = require("../lib/email");
const { deliveryPauseFromRows } = require("../lib/delivery-pause");
const { SEQUENCES } = require("../lib/email-templates");
const { pchSubject } = require("../lib/outreach-email-v2");
const { proofEmailV3Enabled } = require("../lib/proof-email-inputs");
const { normalizeProspect } = require("../lib/packets");
const { buildCheckoutLink, verifyCheckoutLink } = require("../lib/checkout-links");
const { buildOptimizationComparison } = require("../lib/optimization-comparison");
const brand = require("../../../packages/wss-brand-system");
const { extractEvidence } = require("../lib/brightlocal");
const { runFullSystem, truthPacketWithLocalPlan } = require("../lib/full-run");
const {
  REQUIRED_RENDERER,
  buildSiteForgePayload,
  dispatchSiteForgePreview,
  extractAuthoritySummary,
  extractBuildStatus,
  extractBuildUrls,
  extractGenerationFingerprint,
  extractOptimizationManifestUrl,
} = require("../lib/siteforge");
const { probeIntakeGenie } = require("../lib/intake-genie-client");
const siteForgeWebhook = require("../api/webhooks/siteforge");
const ghostAgencyRun = require("../api/ghost-agency/run");
const previewContact = require("../api/preview-contact");
const billingPlans = require("../api/billing/plans");
const { verifyStripeSignature } = require("../lib/stripe");
const stripeWebhook = require("../api/webhooks/stripe");
const buildPreview = require("../api/admin/build-preview");
const outreachUnsubscribe = require("../api/outreach/unsubscribe");

function mockRes() {
  return {
    headers: {},
    statusCode: 0,
    body: "",
    setHeader(key, value) { this.headers[key] = value; },
    end(value) { this.body = value; },
  };
}

function parseListUnsubscribeHeader(value = "") {
  return [...String(value).matchAll(/<([^<>]+)>/g)].map((match) => new URL(match[1]));
}

async function run() {
  const publicRoot = readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  for (const term of [
    "pagehub", "ricardo", "firecrawl", "brightlocal", "brightdata", "leadminer",
    "ghost agency", "truth_packet", "scrape", "crawler", "vapi", "twilio",
    "wss labs", "point_of_interest", "establishment",
  ]) assert.doesNotMatch(publicRoot, new RegExp(term, "i"), `public backend root leaked ${term}`);

  process.env.STRIPE_WEBHOOK_SECRET = "whsec_rollover_test";
  const stripeBody = JSON.stringify({ id: "evt_rollover", type: "checkout.session.completed", data: { object: { metadata: { product: "mission-control", plan: "solo" }, subscription: null } } });
  const stripeTimestamp = String(Math.floor(Date.now() / 1000));
  const validStripeSignature = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${stripeTimestamp}.${stripeBody}`).digest("hex");
  assert.equal(verifyStripeSignature(stripeBody, `t=${stripeTimestamp},v1=${validStripeSignature},v1=${"0".repeat(64)}`).verified, true);
  const stripeRequest = Readable.from([stripeBody]);
  stripeRequest.method = "POST";
  stripeRequest.headers = { "content-type": "application/json", "stripe-signature": `t=${stripeTimestamp},v1=${validStripeSignature}` };
  Object.defineProperty(stripeRequest, "body", { get() { throw new Error("parsed body helper must not be accessed"); } });
  const stripeResponse = mockRes();
  await stripeWebhook(stripeRequest, stripeResponse);
  assert.equal(stripeResponse.statusCode, 200);
  const stripePayload = JSON.parse(stripeResponse.body);
  assert.equal(stripePayload.verification.verified, true);
  assert.equal(stripePayload.fulfillment.mode, "delegated_to_customer_commerce");
  assert.equal(stripePayload.commerce.mode, "delegated_to_customer_commerce");
  assert.equal(stripePayload.customerCommerce.mode, "customer_checkout_recorded_without_subscription");

  const coldSequenceCopy = JSON.stringify(SEQUENCES[1]);
  assert.match(coldSequenceCopy, /I went ahead and rebuilt the site as a free live preview/);
  assert.match(coldSequenceCopy, /Your current website is untouched/);
  assert.doesNotMatch(coldSequenceCopy, /talk to your website and it changes/);
  assert.doesNotMatch(coldSequenceCopy, /reply and I(?:'|\\u0027)ll build you a free custom preview/i);
  assert.doesNotMatch(coldSequenceCopy, /I have not built or published anything/i);
  assert.doesNotMatch(coldSequenceCopy, /\$(?:199|499|799|1,299)(?:\/mo|\/month)?/);
  assert.doesNotMatch(coldSequenceCopy, /preview_url|report_url|checkout_url|sunset_date/i);
  assert.doesNotMatch(coldSequenceCopy, /Stripe|checkout|Launch my site/i);
  assert.doesNotMatch(coldSequenceCopy, /live (?:on my server|until)|comes down|delete(?:d| it)?|backups?|archive it/i);
  const intakeStatus = await probeIntakeGenie();
  assert.equal(intakeStatus.reachable, true);

  const publicPlansRes = mockRes();
  await billingPlans({ method: "GET", headers: { origin: "https://getanswercrew.com" } }, publicPlansRes);
  assert.equal(publicPlansRes.statusCode, 200);
  assert.equal(publicPlansRes.headers["Access-Control-Allow-Origin"], "https://getanswercrew.com");

  const unauthRunRes = mockRes();
  await ghostAgencyRun({ method: "POST", headers: {}, body: {} }, unauthRunRes);
  assert.equal(unauthRunRes.statusCode, 503);
  assert.equal(JSON.parse(unauthRunRes.body).error, "server_auth_unconfigured");

  const contactPayload = buildSiteForgePayload({ prospect: { prospect_id: "lead_contact", business_name: "Contact Test", composition_slot: 3 }, job: { id: "job_contact", packets: {} } });
  assert.equal(contactPayload.prospect.composition_slot, 3);
  assert.equal(contactPayload.contact_capture.method, "POST");
  assert.match(contactPayload.contact_capture.endpoint, /\/api\/preview-contact$/);
  assert.match(contactPayload.contact_capture.fallback_href, /^mailto:/);

  const previewContactRes = mockRes();
  await previewContact({ method: "POST", headers: {}, body: { name: "Owner Test", email_or_phone: "owner@example.test", message: "Please call about the preview.", business_name: "Contact Test", prospect_id: "lead_contact" } }, previewContactRes);
  assert.equal(previewContactRes.statusCode, 200);

  const stats = { total: 12, byStatus: { previewed: 10, new: 2 }, sendable: 10, sent: 3, withEmail: 11 };
  assert.equal(parseDeterministic("send live 10").action, "run_live_campaign");
  assert.equal(parseDeterministic("run campaign now").action, "run_dry_campaign");
  assert.equal(parseDeterministic("dry-run campaign of 5").params.batch, 5);
  assert.equal(parseDeterministic("mine roofing in San Diego").params.industry, "roofing");
  assert.equal(parseDeterministic("how are we doing", stats).action, "none");
  assert.match(parseDeterministic("how are we doing", stats).reply, /Leads in system: 12/);
  assert.equal(emailFrom(), "WSS Labs <hello@wss-ai.com>");
  assert.equal(emailFrom("outreach"), "WSS Labs <hello@go.wss-ai.com>");
  assert.equal(outreachFromStatus().domain, "go.wss-ai.com");
  const unsubscribeHeaders = oneClickUnsubscribeHeaders("https://example.test/unsubscribe");
  assert.deepEqual(unsubscribeHeaders, { "List-Unsubscribe": "<https://example.test/unsubscribe>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  assert.equal(parseListUnsubscribeHeader(unsubscribeHeaders["List-Unsubscribe"])[0].href, "https://example.test/unsubscribe");
  const oneClickUrl = parseListUnsubscribeHeader(oneClickUnsubscribeHeaders(require("../lib/unsubscribe").unsubscribeUrl({ email: "owner@example.test", prospectId: "lead_unsub" }))["List-Unsubscribe"])[0];
  assert.deepEqual(await outreachUnsubscribe.parsePostBody({ headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }), { "List-Unsubscribe": "One-Click" });
  const oneClickRes = mockRes();
  await outreachUnsubscribe({ method: "POST", headers: { host: "ghost.example.test", "x-forwarded-proto": "https", "content-type": "application/x-www-form-urlencoded" }, url: `${oneClickUrl.pathname}${oneClickUrl.search}`, body: "List-Unsubscribe=One-Click" }, oneClickRes);
  assert.equal(oneClickRes.statusCode, 200);
  assert.equal(oneClickRes.body, "");

  let resendPayload;
  const fetchBeforeResendTest = global.fetch;
  process.env.RESEND_API_KEY = "re_test_headers_only";
  try {
    global.fetch = async (url, options = {}) => {
      if (String(url) !== "https://api.resend.com/emails") return fetchBeforeResendTest(url, options);
      resendPayload = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "email_headers_test" }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const mockedSend = await sendResendEmail({ senderKind: "outreach", to: "owner@example.test", subject: "Header test", html: "<p>Header test</p>", text: "Header test", headers: unsubscribeHeaders });
    assert.equal(mockedSend.mode, "sent");
  } finally {
    delete process.env.RESEND_API_KEY;
    global.fetch = fetchBeforeResendTest;
  }
  assert.deepEqual(resendPayload.headers, unsubscribeHeaders);
  assert.equal(parseListUnsubscribeHeader(resendPayload.headers["List-Unsubscribe"])[0].href, "https://example.test/unsubscribe");
  assert.equal(resendPayload.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal(deliveryPauseFromRows([]).active, false);
  assert.deepEqual(deliveryPauseFromRows([{ type: "outreach.delivery_pause", created_at: "2026-07-13T00:00:00.000Z", payload: { active: true, reason: "hard_bounce_rate", runId: "run_test" } }]), { active: true, known: true, reason: "hard_bounce_rate", runId: "run_test", at: "2026-07-13T00:00:00.000Z", stats: null });
  assert.deepEqual(normalizeUsLocation({ city: "Orange CA", state: "TX" }), { city: "Orange", state: "CA" });
  assert.deepEqual(publicServiceNames(["landscaper", "point_of_interest", "establishment", "general_contractor"]), ["Landscaping", "General contracting"]);
  assert.equal(normalizeProspect({ businessName: "No Fabrication", city: "Orange CA", state: "TX" }).state, "CA");
  const claimUrl = new URL(buildCheckoutLink({ prospect: { prospect_id: "lead_claim", business_name: "Claim Co" }, job: { id: "job_claim" } }));
  const claimCheck = verifyCheckoutLink(claimUrl.searchParams.get("token"), claimUrl.searchParams.get("sig"));
  assert.equal(claimCheck.ok, true);
  assert.equal(claimCheck.payload.job_id, "job_claim");

  const merged = prospectFromRow({ prospect_id: "lead_1", status: "previewed", report_url: "https://reports.example/lead_1", record: { prospect_id: "old", status: "new", business_name: "Acme" } });
  assert.equal(merged.prospect_id, "lead_1");
  assert.equal(merged.status, "previewed");
  assert.equal(merged.report_url, "https://reports.example/lead_1");

  const storedPreviewProspect = await buildPreview.resolveProspect({ prospectId: "lead_1" }, async () => ({ ok: true, data: [{ prospect_id: "lead_1", status: "previewed", preview_url: "https://lead-1.wss-ai.com/", record: { business_name: "Acme", truth_packet: { meta: { source: "intake_genie" } } } }] }));
  assert.equal(storedPreviewProspect.prospect_id, "lead_1");
  assert.equal(storedPreviewProspect.business_name, "Acme");
  assert.equal(storedPreviewProspect.truth_packet.meta.source, "intake_genie");
  assert.equal(await buildPreview.resolveProspect({}, async () => ({ ok: true, data: [] })), null);

  assert.equal(extractEmail('<a href="mailto:Owner@Acme.com">Email</a><img src="x@test.png">'), "owner@acme.com");
  assert.equal(extractEmail('<a href="mailto:your@email.com">Email</a>'), null);
  assert.equal(extractEmail('<a href="mailto:name@email.com">Email</a>'), null);
  assert.equal(extractEmail('<a href="mailto:hello@indoorcomfort.com">Email</a>'), "hello@indoorcomfort.com");
  assert.match(prospectIdForPlace({ id: "ChIJ123", displayName: { text: "Acme Roofing" } }), /^place-chij123/);
  assert.ok(scorePlace({ websiteUri: "", nationalPhoneNumber: "555", formattedAddress: "Main", rating: 4.8, userRatingCount: 12 }, "owner@acme.com") > 80);

  const truth = buildBusinessTruthPacket({ profile: { business_name: "Acme Roofing", industry: "roofing", city: "San Diego", state: "CA", phone: "(619) 555-1111" }, found: { contact: { phone: "(858) 555-2222", address: "123 Main St, San Diego CA" }, services: ["roof repair", "roof replacement", "gutters"], photos: ["https://site.test/favicon.png", "https://site.test/gallery/roof-install-1920x1080.webp", "https://site.test/logo.svg"], reviews: ["Fast roof repair and clean work from the whole crew", "The roof repair team was clean, fast, and professional"], seo_gaps: ["no structured data detected", "no FAQ surface for AI answer engines"] }, gbp: { phone: "(619) 555-1111", reviews: [] }, source: "test" });
  assert.equal(truth.meta.version, "goldilocks.v1");
  assert.equal(truth.photos.length, 1);
  assert.ok(truth.photos[0].includes("roof-install"));
  assert.ok(truth.photos.length <= GOLDILOCKS.maxPhotos);
  assert.equal(truth.napConsistency.consistent, false);
  assert.equal(truth.opportunities[0].severity, "high");
  assert.equal(truth.localSearchPlan.status, "candidate_only");
  assert.ok(truth.localSearchPlan.targetTerms.length <= 6);
  assert.ok(truth.localSearchPlan.contentPlan.servicePages <= 4);

  const localEvidence = extractEvidence({ results: { summary: { citations_count: 14, num_reviews: 25, star_rating: 4.7 }, keywords: { "roof repair san diego": { client_rank: 18 } } } });
  const measuredTruth = buildBusinessTruthPacket({ profile: { business_name: "Measured Roofing", industry: "roofing", city: "San Diego", state: "CA" }, found: { services: ["Roof repair", "Roof replacement"], seo_gaps: ["no structured data detected"] }, gbp: { review_count: 25, rating: 4.7, latlng: { lat: 32.7157, lng: -117.1611 } }, localMarketData: localEvidence, source: "test" });
  assert.equal(measuredTruth.localSearchPlan.status, "evidence_backed");
  assert.equal(measuredTruth.localSearchPlan.currentVisibility.termsMeasured, 1);
  assert.equal(measuredTruth.localSearchPlan.citations.length, 1);
  assert.equal(measuredTruth.localSearchPlan.location.coordinatesVerified, true);
  assert.deepEqual(measuredTruth.latlng, { lat: 32.7157, lng: -117.1611 });

  const rowTruth = businessTruthFromProspect({ business_name: "No Site Plumbing", industry: "plumbing", city: "Phoenix", phone: "(480) 555-0101" });
  assert.equal(rowTruth.opportunities[0].type, "missing_website");
  const refreshedTruth = await truthPacketWithLocalPlan({ business_name: "Located Plumbing", industry: "plumbing", city: "Phoenix", state: "AZ", latlng: { lat: 33.4484, lng: -112.074 }, services: ["Drain cleaning", "Water heater repair"], truth_packet: rowTruth }, "test");
  assert.equal(refreshedTruth.localSearchPlan.location.coordinatesVerified, true);
  assert.deepEqual(refreshedTruth.latlng, { lat: 33.4484, lng: -112.074 });

  assert.deepEqual(extractBuildUrls({ data: { reportUrl: "https://reports.example/acme", previewUrl: "https://acme.wss-ai.com/" } }), { report_url: "https://reports.example/acme", preview_url: "https://acme.wss-ai.com/" });
  const authorityFixture = { standard: "authority-108-v1", total: 108, passed: 84, failed: 2, needs_owner_input: 8, runtime_verification: 10, not_applicable: 4 };
  assert.deepEqual(extractAuthoritySummary({ payload: { prospect: { authority_standard: authorityFixture } } }), authorityFixture);
  assert.equal(extractOptimizationManifestUrl({ urls: { optimization_manifest_url: "https://acme.wss-ai.com//optimization-manifest.json" } }), "https://acme.wss-ai.com//optimization-manifest.json");
  assert.equal(REQUIRED_RENDERER, "05-build-v8");
  assert.equal(extractGenerationFingerprint({ result: { composition: { fingerprint: "composition-acme-v8" } } }), "composition-acme-v8");
  const readyBuildStatus = extractBuildStatus({ renderer: REQUIRED_RENDERER, composition_fingerprint: "composition-acme-v8", qc_passed: true, visual_qc_passed: true, qc_contract: "public-surface-v2", data: { reportUrl: "https://reports.example/acme", previewUrl: "https://acme.wss-ai.com/" } });
  assert.equal(readyBuildStatus.ready, true);
  assert.equal(readyBuildStatus.generation_fingerprint, "composition-acme-v8");
  const missingFingerprintStatus = extractBuildStatus({ renderer: REQUIRED_RENDERER, qc_passed: true, visual_qc_passed: true, qc_contract: "public-surface-v2", data: { reportUrl: "https://reports.example/acme", previewUrl: "https://acme.wss-ai.com/" } });
  assert.equal(missingFingerprintStatus.ready, false);
  assert.ok(missingFingerprintStatus.blocked.includes("generation_fingerprint_missing"));
  assert.equal(extractBuildStatus({ renderer: "05-build-v7", generation_fingerprint: "composition-legacy-v7", qc_passed: true, visual_qc_passed: true, qc_contract: "public-surface-v2", data: { reportUrl: "https://reports.example/acme", previewUrl: "https://acme.wss-ai.com/" } }).ready, false);

  const siteForgeDry = await dispatchSiteForgePreview({ prospect: { prospect_id: "lead_ready", business_name: "Ready Roofing" }, job: { id: "job_ready", packets: { site: {}, report: {} } }, truthPacket: rowTruth });
  assert.equal(siteForgeDry.configured, false);
  assert.equal(siteForgeDry.mode, "handoff_packet");
  assert.match(siteForgeDry.payload.prospect.purchase_url, /^https:\/\/ghost\.example\.com\/api\/checkout-link\?/);
  assert.equal(siteForgeDry.payload.requirements.build_type, "premier_multi_page");
  assert.equal(siteForgeDry.payload.requirements.qcContract, "public-surface-v2");
  assert.deepEqual(siteForgeDry.payload.requirements.mustReturn, ["report_url", "preview_url", "generation_fingerprint"]);

  const webhookRes = mockRes();
  await siteForgeWebhook({ method: "POST", headers: { authorization: "Bearer callback-test" }, body: { prospect_id: "lead_ready", data: { reportUrl: "https://reports.example/ready", previewUrl: "https://ready.wss-ai.com/" }, renderer: REQUIRED_RENDERER, composition_fingerprint: "composition-ready-v8", qc_passed: true, visual_qc_passed: true, qc_contract: "public-surface-v2", grade: "A", authority_summary: authorityFixture, urls: { optimization_manifest_url: "https://ready.wss-ai.com//optimization-manifest.json" }, prospect: { business_name: "Ready Roofing" } } }, webhookRes);
  const webhookBody = JSON.parse(webhookRes.body);
  assert.equal(webhookRes.statusCode, 200);
  assert.equal(webhookBody.ignored, true);
  assert.equal(webhookBody.reason, "missing_active_siteforge_job");

  // PLACES IS OPTIONAL (2026-08-25): with no keys at all the default lane now
  // fails closed on the missing DISCOVERY provider, not the missing Places key.
  // env:{} keeps this hermetic even on a machine with real keys exported.
  const noKey = await mineLeads({ industry: "roofing", location: "San Diego CA", limit: 5, trigger: "test", env: {} });
  assert.equal(noKey.ok, false);
  assert.equal(noKey.mode, "no_discovery_key");
  const fullRunNoKey = await runFullSystem({ category: "roofing", location: "San Diego CA", count: 2, dryRun: true });
  assert.equal(fullRunNoKey.ok, false);
  assert.equal(fullRunNoKey.stage, "mined");

  const proofNoBuild = await sendSequenceStep({ prospect: { prospect_id: "lead_consent_no_build", business_name: "Consent Roofing", email: "owner@example.test", city: "Irvine", industry: "roofing" }, sequence: 1, step: 1, dryRun: true });
  assert.equal(proofNoBuild.ok, false, JSON.stringify(proofNoBuild));
  assert.equal(proofNoBuild.blocked, "no_preview_url");

  const savedVisualSecret = process.env.GHOST_AGENCY_VISUAL_SECRET;
  process.env.GHOST_AGENCY_VISUAL_SECRET = "smoke-test-visual-secret";
  const proofNoVisuals = await sendSequenceStep({ prospect: { prospect_id: "lead_legacy_preview", business_name: "Legacy Preview Roofing", email: "owner@example.test", city: "Irvine", industry: "roofing", preview_url: "https://legacy-preview-roofing.wss-ai.com/" }, sequence: 1, step: 1, dryRun: true });
  assert.equal(proofNoVisuals.ok, false, JSON.stringify(proofNoVisuals));
  assert.equal(proofNoVisuals.blocked, "no_before_after_visuals");
  const proofForeignShot = await sendSequenceStep({ prospect: { prospect_id: "lead_foreign_before_shot", business_name: "Legacy Preview Roofing", email: "owner@example.test", city: "Irvine", industry: "roofing", preview_url: "https://legacy-preview-roofing.wss-ai.com/", current_website: "https://legacy-preview-roofing.example.com/", before_shot_source_url: "https://someone-elses-domain.example/" }, sequence: 1, step: 1, dryRun: true });
  assert.equal(proofForeignShot.ok, false, JSON.stringify(proofForeignShot));
  assert.equal(proofForeignShot.blocked, "before_image_capture_domain_mismatch");
  const proofComplete = await sendSequenceStep({ prospect: { prospect_id: "lead_proof_complete", business_name: "Legacy Preview Roofing", email: "owner@example.test", city: "Irvine", industry: "roofing", preview_url: "https://legacy-preview-roofing.wss-ai.com/", current_website: "https://legacy-preview-roofing.example.com/", before_shot_source_url: "https://www.legacy-preview-roofing.example.com/" }, sequence: 1, step: 1, dryRun: true });
  if (savedVisualSecret === undefined) delete process.env.GHOST_AGENCY_VISUAL_SECRET; else process.env.GHOST_AGENCY_VISUAL_SECRET = savedVisualSecret;
  assert.equal(proofComplete.ok, true, JSON.stringify(proofComplete));
  assert.match(proofComplete.htmlPreview, /legacy-preview-roofing\.wss-ai\.com/i);
  assert.match(proofComplete.htmlPreview, /\/api\/media\/preview-shot\?[^"]*v=old/i);
  assert.match(proofComplete.htmlPreview, /\/api\/media\/preview-shot\?[^"]*v=new/i);
  assert.match(proofComplete.htmlPreview, /<img\b[^>]*src="https:\/\/ghost\.wss-ai\.com\/brand\/wss-mark-176\.png"/i);
  assert.doesNotMatch(proofComplete.htmlPreview, /yours, free|included free with your plan/i);
  if (proofEmailV3Enabled()) { assert.match(proofComplete.composedText, /Hosting and SSL/i); assert.doesNotMatch(proofComplete.htmlPreview, /custom domain|your own domain/i); }
  else assert.match(proofComplete.htmlPreview, /Custom domain setup/i);
  assert.doesNotMatch(proofComplete.htmlPreview, /\{[A-Z_]{3,}\}/);

  assert.equal(pchSubject({ businessName: "Acme Plumbing", city: "Irvine", prospectId: "p1" }), "Acme Plumbing, your new website is live. Take a look");
  assert.equal(pchSubject({ businessName: "Austin Air Conditioning", city: "Austin", prospectId: "aa" }), "Austin Air Conditioning, your new website is live. Take a look");
  for (const variant of require("../lib/outreach-email-v2").SUBJECT_POOL) {
    assert.doesNotMatch(variant, /did I get this right|quick one/i);
    assert.ok(variant.includes("{Business Name}"), "every subject variant must carry the business name");
    assert.ok(!/\{industry\}/.test(variant), "no subject variant may carry the trade word");
  }

  const brandedCallPrepReportUrl = "https://callprep.wss-ai.com/report/audit/ready?artifact=scorecard.json";
  const readyReleaseEvidence = {
    schema: "siteforge-release-evidence-v1",
    map: { verified: true, qc_check: { name: "release-map-evidence" }, artifact: "screenshots/desktop/map.png", evidence_artifact: "screenshots/map-evidence.json", manifest_artifact: "screenshots/manifest.json", screenshot: { size: 4096, sha256: "c".repeat(64) }, runtime: { response_ok: true, geometry_ok: true, pixels_ok: true, unique_colors: 32, variance: 120 }, manifest: { schema: "siteforge-screenshot-manifest-v1", map_pass: true }, supporting_checks: [{ name: "visual-satellite-map-evidence", pass: true }, { name: "visual-address-map-directions", pass: true }] },
    identity: { verified: true, qc_check: { name: "release-business-identity-match" }, expected: { business_name: "Ready Roofing" }, actual: { business_name: "Ready Roofing", public_packet_business_name: "Ready Roofing", local_business_nodes: 1 } },
    template_family: { verified: true, qc_check: { name: "release-template-family-match" }, expected: { family: "service-map-pins" }, actual: { family: "service-map-pins" } },
  };
  const dryRun = await sendSequenceStep({ prospect: { prospect_id: "lead_ready", business_name: "Ready Roofing", email: "owner@example.test", city: "Irvine", industry: "roofing", report_url: brandedCallPrepReportUrl, preview_url: "https://ready-roofing.wss-ai.com/", current_website: "https://ready-roofing-current.example.com/", before_shot_source_url: "https://ready-roofing-current.example.com/", preview_expires_at: "July 31, 2026", checkout_url: "https://checkout.example/ready", siteforge_qc_passed: true, siteforge_visual_qc_passed: true, siteforge_qc_contract: "public-surface-v2", siteforge_renderer: REQUIRED_RENDERER, siteforge_generation_fingerprint: "ready-roofing-v8", release_evidence: readyReleaseEvidence, authority_summary: authorityFixture, truth_packet: { services: ["Roof repair", "Roof replacement"], photos: [], localSearchPlan: truth.localSearchPlan, opportunities: [{ type: "no_schema", headline: "No structured data detected" }, { type: "no_faq", headline: "No FAQ detected" }], intakeGenie: { facts: { name: "Ready Roofing", city: "Irvine", state: "CA", category: "roofing", services: ["Roof repair", "Roof replacement"] }, assets: [], evidence: [], generation_fingerprint: "ready-roofing-v8", release_evidence: readyReleaseEvidence } } }, sequence: 1, step: 1, dryRun: true });
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.mode, "dry_run");
  assert.equal(dryRun.subject, "Ready Roofing, your new website is live. Take a look");
  assert.deepEqual(dryRun.cc, ["woodwardsoftware@gmail.com"]);
  assert.equal(dryRun.previewExpiresOn, null);
  assert.match(dryRun.headers["List-Unsubscribe"], /^<https:\/\/ghost\.example\.com\/api\/outreach\/unsubscribe\?t=/);
  assert.equal(dryRun.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.match(dryRun.htmlPreview, /name="viewport"/);
  assert.match(dryRun.htmlPreview, /charset="utf-8"/);
  assert.match(dryRun.htmlPreview, /max-width:600px/);
  const consentEmailText = dryRun.htmlPreview.replace(/<[^>]*>/g, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/(?:&#39;|&#x27;|&apos;)/gi, "'").replace(/&mdash;/gi, "—").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
  if (proofEmailV3Enabled()) {
    assert.match(consentEmailText, /Ready Roofing, we already built your new website\./);
    assert.match(consentEmailText, /Meet Riley/);
    assert.match(consentEmailText, /Your own web developer, on the phone\./);
    assert.match(consentEmailText, /We scan local businesses around Irvine/);
    assert.doesNotMatch(consentEmailText, /all your social accounts in one feed/i);
  } else {
    assert.match(consentEmailText, /Hi Ready Roofing team,/);
    assert.match(consentEmailText, /My name is Mark Woodward, and I own an AI-powered web studio here in California/);
    assert.match(consentEmailText, /Riley, your own AI web person you can CALL anytime/);
    assert.match(consentEmailText, /WSS Connect — all your social accounts in one feed, built in/);
    assert.match(consentEmailText, /Irvine roofing competitor & search research/);
  }
  assert.match(consentEmailText, /123 Real St, Irvine, CA 92618/);
  assert.match(dryRun.htmlPreview, /ready-roofing\.wss-ai\.com/i);
  assert.match(dryRun.htmlPreview, /\/api\/media\/preview-shot\?[^"]*v=old/i);
  assert.match(dryRun.htmlPreview, /\/api\/media\/preview-shot\?[^"]*v=new/i);
  // The WSS sender mark, the before shot, the after shot — plus, on the V3
  // shell, Riley's avatar (served from our own /brand/ directory exactly like
  // the mark), the after shot a second time as the how-to-get-in door
  // thumbnail (2026-08-12 compression pass), and the WSS Connect funnel
  // graphic (9a83689, 2026-08-13, promoted from attachment to inline <img>
  // without this count being bumped — the smoke suite ran red from that day).
  const dryRunImages = [...dryRun.htmlPreview.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)]
    .map((match) => match[1].replace(/&amp;/g, "&"));
  assert.equal(dryRunImages.length, proofEmailV3Enabled() ? 9 : 3, JSON.stringify(dryRunImages));
  for (const src of dryRunImages) {
    assert.match(src, /^https:\/\/(?:[a-z0-9-]+\.)*wss-ai\.com\//i, `third-party image host: ${src}`);
  }
  assert.match(dryRun.htmlPreview, /<img\b[^>]*src="https:\/\/ghost\.wss-ai\.com\/brand\/wss-mark-176\.png"/i);
  // Still forbidden: third-party screenshot hosts and iframes.
  assert.doesNotMatch(dryRun.htmlPreview, /s0\.wp\.com\/mshots|<iframe\b/i);
  // Proof-first SAYS it rebuilt the site — that claim is the point of the email.
  assert.match(
    dryRun.htmlPreview,
    proofEmailV3Enabled() ? /we already built your new website/i : /went ahead and rebuilt/i,
  );
  // Promises we cannot fulfil must never come back.
  assert.doesNotMatch(dryRun.htmlPreview, /yours, free|included free with your plan/i);
  if (proofEmailV3Enabled()) {
    // 2026-09-02 polish-v2 mock: the connect-funnel.png <img> retired (owner
    // showpiece note); the drawn WSS Connect app-frame reuses the W mark, so
    // the mark image now appears in the set alongside Riley's avatar.
    assert.ok(dryRunImages.includes("https://ghost.wss-ai.com/brand/wss-mark-176.png"));
    assert.ok(dryRunImages.includes("https://ghost.wss-ai.com/brand/riley-avatar.png"));
  }
  for (const src of dryRunImages) assert.match(src, /^https:\/\/(?:[a-z0-9-]+\.)*wss-ai\.com\//i, `third-party image host: ${src}`);
  assert.match(dryRun.htmlPreview, /<img\b[^>]*src="https:\/\/ghost\.wss-ai\.com\/brand\/wss-mark-176\.png"/i);
  assert.doesNotMatch(dryRun.htmlPreview, /s0\.wp\.com\/mshots|<iframe\b/i);
  assert.match(dryRun.htmlPreview, proofEmailV3Enabled() ? /we already built your new website/i : /went ahead and rebuilt/i);
  assert.doesNotMatch(dryRun.htmlPreview, /yours, free|included free with your plan/i);
  if (proofEmailV3Enabled()) assert.doesNotMatch(dryRun.htmlPreview, /custom domain|your own domain/i); else assert.match(dryRun.htmlPreview, /Custom domain setup/i);
  assert.doesNotMatch(dryRun.htmlPreview, /__MISSING_/);

  const consoleHtml = require("../lib/console-page");
  assert.match(consoleHtml, /WSS Command Center — approved redesign/);
  // Campaign-flow pass 2026-08-16: the assembly line was retired from the
  // owner face; the front door is the numbered Start-a-new-campaign wizard
  // ending in one Start-my-campaign GO button.
  assert.match(consoleHtml, /Start a new campaign/);
  assert.match(consoleHtml, /Start my campaign/);
  assert.match(consoleHtml, /Who are we reaching\?/);
  assert.match(consoleHtml, /How many websites\?/);
  assert.match(consoleHtml, /Practice or real\?/);
  const launchButtonCounts = [...consoleHtml.matchAll(/<button\b[^>]*\bdata-n="(\d+)"[^>]*>/g)]
    .map((match) => Number(match[1]));
  assert.deepEqual(launchButtonCounts, [10, 50, 100, 500]);
  // The campaign launcher allocates exact per-wave quotas and pins lane/target
  // before dispatch. The POST contract must carry that exact quota and the
  // session-pinned lane; post() itself attaches the retry-safe idempotency key.
  assert.match(consoleHtml, /post\("\/api\/admin\/line",\{action:"start",count:quota,target:t,lane:campaignLane\}\)/);
  assert.match(consoleHtml, /function allocateWaveQuotas\(remaining,slots,perBatchCap\)/);
  assert.match(consoleHtml, /var goal=count,found=0,requested=0,runs=0/);
  assert.match(consoleHtml, /if\(path==="\/api\/admin\/line"&&body&&body\.action==="start"&&!body\.idempotencyKey\)/);
  assert.match(consoleHtml, /body=Object\.assign\(\{\},body,\{idempotencyKey:startKeyFor\(signature\)\}\)/);
  assert.match(consoleHtml, /function currentLane\(\)\{return laneModeBtn&&laneModeBtn\.getAttribute\("data-lane"\)==="live"\?"live":"sandbox";\}/, "currentLane must default to sandbox and require an explicit live toggle");
  assert.match(consoleHtml, /wsl_admin_token/);
  assert.match(consoleHtml, /opts\.headers\["x-admin-token"\]=token\(\)/);
  assert.doesNotMatch(consoleHtml, /Reply queue|Run on autopilot|Live prospects/);
  assert.doesNotMatch(consoleHtml, />Build preview|>Load leads/);

  const { renderOperatorDashboard } = require("../lib/dashboard-html");
  const deckHtml = renderOperatorDashboard({ events: [], calls: [], tickets: [], products: [] });
  assert.match(deckHtml, /WSS Labs/);
  assert.match(deckHtml, /Hanken Grotesk/);
  assert.match(brand.tokensCss, /--wss-void/);
  assert.match(brand.assets.mark, /34D399/);
  const napComparison = buildOptimizationComparison({ city: "Orange", truth_packet: { services: ["Landscape design"], opportunities: [{ type: "nap_mismatch", headline: "Phone differs between the website and business profile" }] } });
  assert.match(napComparison.text, /Contact consistency/);
  assert.match(napComparison.text, /One verified phone and address set/);
}

run().then(() => console.log("Smoke tests OK")).catch((error) => { console.error(error); process.exit(1); });
