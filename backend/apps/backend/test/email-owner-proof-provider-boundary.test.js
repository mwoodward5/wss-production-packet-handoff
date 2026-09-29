"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const emailPath = require.resolve("../lib/email");
const storePath = require.resolve("../lib/store");
const { clearReportGradeCache } = require("../lib/report-grade");

const REPORT_ID = "3f6c2b1a-7d4e-4c2b-9a1f-0e5d8c7b6a44";
const REPORT_URL = `https://callprep.wss-ai.com/report/${REPORT_ID}`;
const PREVIEW_URL = "https://boundary-business.wss-ai.com/";
const CURRENT_URL = "https://boundarybusiness.test/";
const PACKET_TOKEN = `wss-genie-cert-v1:${"c".repeat(64)}`;

async function withHarness({
  canonicalStatus = "new",
  canonicalEmail = "Prospect@BoundaryBusiness.COM",
  canonicalReportUrl = REPORT_URL,
  canonicalReceiptSignature = "c".repeat(64),
  canonicalDomain = "boundarybusiness.test",
  reportBusinessUrl = CURRENT_URL,
  suppressOnRead = 0,
  dropResendOnSuppressionRead = 0,
  dropResendOnCanonicalRead = 0,
} = {}, run) {
  const priorEmail = require.cache[emailPath];
  const priorStore = require.cache[storePath];
  const priorFetch = global.fetch;
  const priorEnv = { ...process.env };
  const providerBodies = [];
  const reportReads = [];
  const suppressionQueries = [];
  let suppressionReads = 0;
  let canonicalReads = 0;
  const sourceEmail = canonicalEmail;
  const prospectId = "owner-proof-boundary-1";

  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@wss-ai.test";
  process.env.GHOST_AGENCY_OUTREACH_FROM = "WSS Labs <hello@go.wss-ai.com>";
  process.env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.EMAIL_UNSUB_SECRET = "test-unsubscribe-secret";
  process.env.GHOST_AGENCY_PROOF_EMAIL_V3 = "0";
  process.env.GHOST_AGENCY_PROSPECT_SEND_ENABLED = "true";
  process.env.CALLPREP_SUPABASE_URL = "https://qjiszykrgqdwlvooicvk.supabase.co";
  process.env.CALLPREP_SUPABASE_ANON_KEY = "test-callprep-anon-key";
  delete process.env.GHOST_AGENCY_REVIEW_HOLD;
  clearReportGradeCache();

  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      recordEvent: async () => ({ ok: true }),
      upsertRow: async () => ({ ok: true }),
      select: async (table, query) => {
        if (table === "ghost_agency_suppressions") {
          suppressionQueries.push(String(query || ""));
          suppressionReads += 1;
          if (dropResendOnSuppressionRead === suppressionReads) {
            delete process.env.RESEND_API_KEY;
          }
          return {
            ok: true,
            data: suppressOnRead === suppressionReads
              ? [{ suppression_key: prospectId, email: null, prospect_id: prospectId }]
              : [],
          };
        }
        if (table === "ghost_agency_prospects") {
          canonicalReads += 1;
          if (dropResendOnCanonicalRead === canonicalReads) {
            delete process.env.RESEND_API_KEY;
          }
          return {
            ok: true,
            data: [{
              prospect_id: prospectId,
              status: canonicalStatus,
              email: canonicalEmail,
              owner_email: null,
              record: {
                status: canonicalStatus,
                email: canonicalEmail,
                report_url: canonicalReportUrl,
                genie_content_certification: {
                  signature: canonicalReceiptSignature,
                  identity: {
                    business_name: "Boundary Business",
                    canonical_domain: canonicalDomain,
                    city: "Irvine",
                    state: "CA",
                    category: "plumbing",
                  },
                },
              },
            }],
          };
        }
        return { ok: true, data: [] };
      },
    },
  };
  delete require.cache[emailPath];
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("/functions/v1/get-business-report")) {
      reportReads.push(String(url));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            id: REPORT_ID,
            business_name: "Boundary Business",
            business_url: reportBusinessUrl,
            overall_grade: "B",
            overall_score: 83,
            data_availability: { gbp: true, social: true, website: true },
            source_snapshot: {
              packet_id: PACKET_TOKEN,
              business_name: "Boundary Business",
              city: "Irvine",
              state: "CA",
              industry: "plumbing",
              categories: {},
            },
          },
        }),
      };
    }
    providerBodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ id: "provider-owner-proof" }) };
  };

  try {
    const email = require("../lib/email");
    return await run({
      email,
      providerBodies,
      reportReads,
      sourceEmail,
      prospectId,
      suppressionQueries,
      counts: () => ({ suppressionReads, canonicalReads }),
    });
  } finally {
    global.fetch = priorFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in priorEnv)) delete process.env[key];
    }
    Object.assign(process.env, priorEnv);
    delete require.cache[emailPath];
    delete require.cache[storePath];
    clearReportGradeCache();
    if (priorEmail) require.cache[emailPath] = priorEmail;
    if (priorStore) require.cache[storePath] = priorStore;
  }
}

function ownerProofInput({ sourceEmail, prospectId, canonicalDomain = "boundarybusiness.test" }) {
  return {
    prospect: {
      prospect_id: prospectId,
      status: "new",
      business_name: "Boundary Business",
      city: "Irvine",
      industry: "plumbing",
      email: "owner@wss-ai.test",
      owner_email: "owner@wss-ai.test",
      record: {
        status: "new",
        email: "owner@wss-ai.test",
        genie_content_certification: {
          signature: "c".repeat(64),
          identity: {
            business_name: "Boundary Business",
            canonical_domain: canonicalDomain,
            city: "Irvine",
            state: "CA",
            category: "plumbing",
          },
        },
      },
    },
    sequence: 2,
    step: 1,
    dryRun: false,
    internalOwnerProof: true,
    sourceRecipientEmail: sourceEmail,
    requireCanonicalRecipientGuard: true,
    allowReviewHoldBypass: true,
    allowDeliveryPauseBypass: true,
    allowContactHoldBypass: true,
    persistCampaignLog: false,
  };
}

function ownerPracticeInput({ sourceEmail, prospectId, canonicalDomain = "boundarybusiness.test" }) {
  const input = ownerProofInput({ sourceEmail, prospectId, canonicalDomain });
  return {
    ...input,
    prospect: {
      ...input.prospect,
      preview_url: PREVIEW_URL,
      current_website: CURRENT_URL,
      before_shot_source_url: CURRENT_URL,
      report_url: REPORT_URL,
    },
    sequence: 1,
    step: 1,
    lineBatchApproved: true,
    requireSignalReportInEmail: true,
    verifyOwnerPracticeReceipt: (_prospect, record) => ({
      ok: true,
      receipt: record.genie_content_certification,
    }),
  };
}

test("owner proof ignores prospect suppression because its envelope is owner-only", async () => {
  await withHarness({ suppressOnRead: 2 }, async ({ email, providerBodies, sourceEmail, prospectId, counts }) => {
    const result = await email.sendSequenceStep(ownerProofInput({ sourceEmail, prospectId }));
    assert.equal(result.mode, "sent", JSON.stringify(result));
    assert.deepEqual(counts(), { suppressionReads: 0, canonicalReads: 1 });
    assert.equal(providerBodies.length, 1);
    assert.equal(providerBodies[0].to, "owner@wss-ai.test");
    assert.equal(providerBodies[0].cc, undefined);
    assert.equal(providerBodies[0].bcc, undefined);
  });
});

test("owner Practice ignores prospect-only terminal contact states", async () => {
  for (const canonicalStatus of [
    "do_not_contact",
    "unsubscribed",
    "bounced",
    "closed_lost",
    "archived",
    "sent",
    "paid",
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await withHarness({ canonicalStatus }, async ({ email, providerBodies, sourceEmail, prospectId, counts }) => {
      const result = await email.sendSequenceStep(ownerPracticeInput({ sourceEmail, prospectId }));
      assert.equal(result.mode, "sent", `${canonicalStatus}: ${JSON.stringify(result)}`);
      assert.deepEqual(counts(), { suppressionReads: 0, canonicalReads: 1 });
      assert.equal(providerBodies.length, 1);
      assert.equal(providerBodies[0].to, "owner@wss-ai.test");
      assert.equal(providerBodies[0].cc, undefined);
      assert.equal(providerBodies[0].bcc, undefined);
    });
  }
});

test("a clean owner proof remains owner-only after both provider-boundary checks", async () => {
  await withHarness({}, async ({ email, providerBodies, sourceEmail, prospectId, counts }) => {
    const result = await email.sendSequenceStep(ownerProofInput({ sourceEmail, prospectId }));
    assert.equal(result.mode, "sent", JSON.stringify(result));
    assert.deepEqual(counts(), { suppressionReads: 0, canonicalReads: 1 });
    assert.equal(providerBodies.length, 1);
    assert.equal(providerBodies[0].to, "owner@wss-ai.test");
    assert.equal(providerBodies[0].cc, undefined);
    assert.equal(providerBodies[0].bcc, undefined);
  });
});

test("a last-boundary Resend config loss preserves its retryable reason without a provider call", async () => {
  await withHarness({ dropResendOnCanonicalRead: 1 }, async ({
    email,
    providerBodies,
    sourceEmail,
    prospectId,
  }) => {
    const result = await email.sendSequenceStep(ownerProofInput({ sourceEmail, prospectId }));
    assert.equal(result.ok, false);
    assert.equal(result.mode, "dry_run");
    assert.equal(result.blocked, "resend_not_configured");
    assert.equal(result.configured, false);
    assert.equal(result.reason, "RESEND_API_KEY and/or sender email not configured");
    assert.equal(providerBodies.length, 0);
  });
});

test("owner proof without an explicit source still skips prospect suppression", async () => {
  await withHarness({ suppressOnRead: 2 }, async ({ email, providerBodies, sourceEmail, prospectId, counts }) => {
    const input = ownerProofInput({ sourceEmail, prospectId });
    delete input.sourceRecipientEmail;
    delete input.requireCanonicalRecipientGuard;
    const result = await email.sendSequenceStep(input);
    assert.equal(result.mode, "sent", JSON.stringify(result));
    assert.deepEqual(counts(), { suppressionReads: 0, canonicalReads: 1 });
    assert.equal(providerBodies.length, 1);
  });
});

test("owner proof ignores a malformed unused source address", async () => {
  await withHarness({}, async ({ email, providerBodies, prospectId, counts }) => {
    const result = await email.sendSequenceStep(ownerProofInput({
      sourceEmail: "not-an-email",
      prospectId,
    }));
    assert.equal(result.mode, "sent", JSON.stringify(result));
    assert.deepEqual(counts(), { suppressionReads: 0, canonicalReads: 1 });
    assert.equal(providerBodies.length, 1);
  });
});

test("owner Practice needs no prospect compliance secrets and mints no unsubscribe link", async () => {
  await withHarness({}, async ({ email, providerBodies, sourceEmail, prospectId }) => {
    process.env.GHOST_AGENCY_VISUAL_SECRET = "owner-proof-visual-secret";
    delete process.env.GHOST_AGENCY_POSTAL_ADDRESS;
    delete process.env.EMAIL_UNSUB_SECRET;
    delete process.env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET;

    const ownerResult = await email.sendSequenceStep(ownerPracticeInput({ sourceEmail, prospectId }));
    assert.equal(ownerResult.mode, "sent", JSON.stringify(ownerResult));
    assert.equal(providerBodies.length, 1);
    assert.equal(providerBodies[0].to, "owner@wss-ai.test");
    assert.doesNotMatch(JSON.stringify(providerBodies[0]), /List-Unsubscribe|\/api\/outreach\/unsubscribe/i);
    assert.match(providerBodies[0].html, /Owner-only Practice proof/i);
    assert.match(providerBodies[0].text, /No prospect was emailed/i);

    const liveResult = await email.sendSequenceStep({
      prospect: {
        prospect_id: `${prospectId}-live-compliance`,
        status: "new",
        business_name: "Boundary Business",
        city: "Irvine",
        industry: "plumbing",
        email: sourceEmail,
      },
      sequence: 2,
      step: 1,
      dryRun: false,
      persistCampaignLog: false,
    });
    assert.equal(liveResult.ok, false);
    assert.equal(liveResult.blocked, "postal_address_missing");
    assert.equal(providerBodies.length, 1, "Live must not cross the provider without compliance config");
  });
});

test("a normal live send cannot replace its suppression identity with sourceRecipientEmail", async () => {
  await withHarness({ suppressOnRead: 1 }, async ({
    email,
    providerBodies,
    prospectId,
    suppressionQueries,
  }) => {
    const result = await email.sendSequenceStep({
      prospect: {
        prospect_id: prospectId,
        status: "new",
        business_name: "Boundary Business",
        city: "Irvine",
        industry: "plumbing",
        email: "suppressed@boundarybusiness.com",
      },
      sequence: 2,
      step: 1,
      dryRun: false,
      sourceRecipientEmail: "clean@somewhere-else.com",
      persistCampaignLog: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocked, "suppressed");
    assert.match(suppressionQueries[0], /email\.eq\.suppressed%40boundarybusiness\.com/);
    assert.doesNotMatch(suppressionQueries[0], /clean%40somewhere-else\.com/);
    assert.equal(providerBodies.length, 0);
  });
});

test("owner-only Practice with no canonical email sends once to the owner", async () => {
  await withHarness({ canonicalEmail: null }, async ({
    email,
    providerBodies,
    prospectId,
    reportReads,
    sourceEmail,
    suppressionQueries,
    counts,
  }) => {
    const result = await email.sendSequenceStep(ownerPracticeInput({ sourceEmail, prospectId }));
    assert.equal(result.mode, "sent", JSON.stringify(result));
    assert.equal(reportReads.length, 1, "the test did not exercise the Practice Signal path");
    assert.deepEqual(counts(), { suppressionReads: 0, canonicalReads: 1 });
    assert.equal(suppressionQueries.length, 0);
    assert.equal(providerBodies.length, 1);
    assert.equal(providerBodies[0].to, "owner@wss-ai.test");
    assert.equal(providerBodies[0].cc, undefined);
    assert.equal(providerBodies[0].bcc, undefined);
  });
});

test("owner-only Practice rejects a fabricated 64-hex receipt through the real verifier", async () => {
  await withHarness({}, async ({
    email,
    providerBodies,
    prospectId,
    reportReads,
    sourceEmail,
  }) => {
    const input = ownerPracticeInput({ sourceEmail, prospectId });
    assert.match(
      input.prospect.record.genie_content_certification.signature,
      /^[a-f0-9]{64}$/,
      "fixture must prove that receipt shape alone is not trusted",
    );
    delete input.verifyOwnerPracticeReceipt;

    const result = await email.sendSequenceStep(input);

    assert.equal(result.ok, false);
    assert.equal(result.blocked, "owner_proof_signal_packet_unverified");
    assert.equal(result.providerAttempted, false);
    assert.equal(reportReads.length, 0);
    assert.equal(providerBodies.length, 0);
  });
});

test("prospect-id suppression does not block owner-only Practice", async () => {
  await withHarness({ canonicalEmail: null, suppressOnRead: 2 }, async ({
    email,
    providerBodies,
    prospectId,
    reportReads,
    sourceEmail,
    suppressionQueries,
    counts,
  }) => {
    const result = await email.sendSequenceStep(ownerPracticeInput({ sourceEmail, prospectId }));
    assert.equal(result.mode, "sent", JSON.stringify(result));
    assert.equal(reportReads.length, 1, "the test did not exercise the Practice Signal path");
    assert.deepEqual(counts(), { suppressionReads: 0, canonicalReads: 1 });
    assert.equal(suppressionQueries.length, 0);
    assert.equal(providerBodies.length, 1);
  });
});

test("sport-fencing truth mismatch blocks owner proof and Live delivery", async () => {
  await withHarness({ canonicalStatus: "vertical_mismatch_sport_fencing" }, async ({
    email,
    providerBodies,
    sourceEmail,
    prospectId,
  }) => {
    const ownerResult = await email.sendSequenceStep(ownerProofInput({ sourceEmail, prospectId }));
    assert.equal(ownerResult.ok, false);
    assert.equal(ownerResult.blocked, "vertical_mismatch_sport_fencing");
    assert.equal(providerBodies.length, 0);

    const liveResult = await email.sendSequenceStep({
      prospect: {
        prospect_id: `${prospectId}-live`,
        status: "vertical_mismatch_sport_fencing",
        business_name: "Boundary Business",
        city: "Irvine",
        industry: "plumbing",
        email: "prospect@boundarybusiness.test",
      },
      sequence: 2,
      step: 1,
      dryRun: false,
      persistCampaignLog: false,
    });
    assert.equal(liveResult.ok, false);
    assert.equal(liveResult.blocked, "prospect_status_vertical_mismatch_sport_fencing");
    assert.equal(providerBodies.length, 0);
  });
});

test("certified website-less owner Practice sends an after-only proof", async () => {
  await withHarness({ canonicalDomain: "", reportBusinessUrl: "" }, async ({
    email,
    providerBodies,
    sourceEmail,
    prospectId,
  }) => {
    const input = ownerPracticeInput({ sourceEmail, prospectId, canonicalDomain: "" });
    delete input.prospect.current_website;
    delete input.prospect.before_shot_source_url;

    const result = await email.sendSequenceStep(input);

    assert.equal(result.mode, "sent", JSON.stringify(result));
    assert.equal(providerBodies.length, 1);
    assert.doesNotMatch(providerBodies[0].html, /YOUR SITE TODAY|Your site today/i);
    assert.doesNotMatch(providerBodies[0].text, /your site today/i);
    assert.equal(providerBodies[0].to, "owner@wss-ai.test");
    assert.equal(providerBodies[0].cc, undefined);
    assert.equal(providerBodies[0].bcc, undefined);
  });
});

test("a known current website with no before proof still blocks owner Practice", async () => {
  await withHarness({}, async ({ email, providerBodies, sourceEmail, prospectId }) => {
    const input = ownerPracticeInput({ sourceEmail, prospectId });
    delete input.prospect.current_website;
    delete input.prospect.before_shot_source_url;

    const result = await email.sendSequenceStep(input);

    assert.equal(result.ok, false);
    assert.equal(result.blocked, "no_before_after_visuals");
    assert.equal(providerBodies.length, 0);
  });
});

test("Live website-less Step 1 still requires the established before-and-after gate", async () => {
  await withHarness({ canonicalDomain: "", reportBusinessUrl: "" }, async ({
    email,
    providerBodies,
    sourceEmail,
    prospectId,
  }) => {
    const input = ownerPracticeInput({ sourceEmail, prospectId, canonicalDomain: "" });
    input.internalOwnerProof = false;
    input.prospect.email = sourceEmail;
    input.prospect.owner_email = sourceEmail;
    input.prospect.record.email = sourceEmail;
    delete input.sourceRecipientEmail;
    delete input.requireCanonicalRecipientGuard;
    delete input.prospect.current_website;
    delete input.prospect.before_shot_source_url;

    const result = await email.sendSequenceStep(input);

    assert.equal(result.ok, false);
    assert.equal(result.blocked, "no_before_after_visuals");
    assert.equal(providerBodies.length, 0);
  });
});

test("owner-only Practice rechecks the canonical Signal binding immediately before provider", async () => {
  for (const options of [
    { canonicalReportUrl: `https://callprep.wss-ai.com/report/7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d` },
    { canonicalReceiptSignature: "e".repeat(64) },
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await withHarness(options, async ({ email, providerBodies, sourceEmail, prospectId }) => {
      // OWNER LAW (2026-09-02): internal owner-inbox sends follow the
      // production gate set — a boundary identity mismatch warns and composes
      // instead of blocking (prospects never had this gate at all).
      const result = await email.sendSequenceStep(ownerPracticeInput({ sourceEmail, prospectId }));
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(providerBodies.length, 1, "the mismatched report must not stop the internal send");
    });
  }
});

test("owner-only Practice fails closed when the final active public release check changes", async () => {
  await withHarness({}, async ({
    email,
    providerBodies,
    reportReads,
    sourceEmail,
    prospectId,
    counts,
  }) => {
    let releaseChecks = 0;
    const input = ownerPracticeInput({ sourceEmail, prospectId });
    input.requireOwnerPracticeActiveRelease = true;
    input.verifyOwnerPracticeActiveRelease = async () => {
      releaseChecks += 1;
      assert.deepEqual(counts(), { suppressionReads: 0, canonicalReads: 1 });
      assert.equal(reportReads.length, 1, "Signal must be checked before the public release");
      return false;
    };

    const result = await email.sendSequenceStep(input);

    assert.equal(result.ok, false);
    assert.equal(result.blocked, "owner_proof_public_release_unavailable");
    assert.equal(result.releaseFailureKind, "transient");
    assert.equal(result.retryableBeforeProvider, true);
    assert.equal(result.providerAttempted, false);
    assert.equal(releaseChecks, 1);
    assert.equal(providerBodies.length, 0);
  });
});
