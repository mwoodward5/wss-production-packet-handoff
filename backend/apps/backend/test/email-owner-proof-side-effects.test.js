"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const emailPath = require.resolve("../lib/email");
const storePath = require.resolve("../lib/store");
const reviewFacePath = require.resolve("../lib/review-face-mirror");
const magicLinkPath = require.resolve("../lib/wss-connect-assets/magic-link");
const outreachDnsPath = require.resolve("../lib/outreach-dns");
const sendPolicyPath = require.resolve("../lib/send-policy");
const deliveryPausePath = require.resolve("../lib/delivery-pause");
const { clearReportGradeCache } = require("../lib/report-grade");

const REPORT_ID = "3f6c2b1a-7d4e-4c2b-9a1f-0e5d8c7b6a44";
const REPORT_URL = `https://callprep.wss-ai.com/report/${REPORT_ID}`;
const PREVIEW_URL = "https://boundary-business.wss-ai.com/";
const CURRENT_URL = "https://boundarybusiness.test/";
const PROSPECT_ID = "owner-proof-side-effects-1";
const PROSPECT_EMAIL = "prospect@boundarybusiness.test";
const OWNER_EMAIL = "owner@wss-ai.test";
const CERT_SIGNATURE = "c".repeat(64);
const REVIEWER_FACE = "https://lh3.googleusercontent.com/a-/ALV-UjWssReviewerFace=s64-c";

function cacheModule(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

async function withHarness(run) {
  const mockedPaths = [
    emailPath,
    storePath,
    reviewFacePath,
    magicLinkPath,
    outreachDnsPath,
    sendPolicyPath,
    deliveryPausePath,
  ];
  const priorModules = new Map(mockedPaths.map((modulePath) => [modulePath, require.cache[modulePath]]));
  const priorFetch = global.fetch;
  const priorEnv = { ...process.env };
  const calls = {
    mirrorReviewFace: [],
    prospectMagicLink: [],
    provider: [],
    report: [],
    upsert: [],
    insertRow: [],
  };

  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.GHOST_AGENCY_OWNER_EMAIL = OWNER_EMAIL;
  process.env.GHOST_AGENCY_OUTREACH_FROM = "WSS Labs <hello@go.wss-ai.com>";
  process.env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.EMAIL_UNSUB_SECRET = "test-unsubscribe-secret";
  process.env.GHOST_AGENCY_PROOF_EMAIL_V3 = "1";
  process.env.GHOST_AGENCY_PROSPECT_SEND_ENABLED = "true";
  process.env.CALLPREP_SUPABASE_URL = "https://qjiszykrgqdwlvooicvk.supabase.co";
  process.env.CALLPREP_SUPABASE_ANON_KEY = "test-callprep-anon-key";
  delete process.env.GHOST_AGENCY_REVIEW_HOLD;
  clearReportGradeCache();

  cacheModule(storePath, {
    recordEvent: async () => ({ ok: true }),
    upsertRow: async (...args) => {
      calls.upsert.push(args);
      return { ok: true };
    },
    insertRow: async (...args) => {
      calls.insertRow.push(args);
      if (calls.insertRowShouldConflict === true) {
        return { ok: false, mode: "live_write_failed", status: 409, error: { code: "23505" } };
      }
      return { ok: true, mode: "live_write" };
    },
    select: async (table) => {
      if (table === "ghost_agency_suppressions") return { ok: true, data: [] };
      if (table === "ghost_agency_prospects") {
        return {
          ok: true,
          data: [{
            prospect_id: PROSPECT_ID,
            status: "new",
            email: PROSPECT_EMAIL,
            record: {
              status: "new",
              email: PROSPECT_EMAIL,
              report_url: REPORT_URL,
              genie_content_certification: {
                signature: CERT_SIGNATURE,
                identity: {
                  business_name: "Boundary Business",
                  canonical_domain: "boundarybusiness.test",
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
  });
  cacheModule(reviewFacePath, {
    mirrorReviewFace: async (input) => {
      calls.mirrorReviewFace.push(input);
      return { ok: true, sha: "f".repeat(64) };
    },
  });
  cacheModule(magicLinkPath, {
    prospectMagicLink: async (input) => {
      calls.prospectMagicLink.push(input);
      return {
        provisioned: true,
        dashboardUrl: "https://boundary-business.wss-ai.com/dashboard",
        magicLink: "https://boundary-business.wss-ai.com/dashboard#t=test-token",
        pin: "424242",
      };
    },
  });
  cacheModule(outreachDnsPath, { outreachDnsStatus: async () => ({ ok: true }) });
  cacheModule(sendPolicyPath, {
    prospectSendsEnabled: () => true,
    waitForProspectSendSlot: async () => {},
  });
  cacheModule(deliveryPausePath, { deliveryPauseStatus: async () => ({ active: false }) });

  delete require.cache[emailPath];
  global.fetch = async (url, options = {}) => {
    if (String(url).includes("/functions/v1/get-business-report")) {
      calls.report.push(String(url));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            id: REPORT_ID,
            business_name: "Boundary Business",
            business_url: CURRENT_URL,
            overall_grade: "B",
            overall_score: 83,
            source_snapshot: {
              packet_id: `wss-genie-cert-v1:${CERT_SIGNATURE}`,
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
    calls.provider.push({ url: String(url), options, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ id: "provider-side-effects" }) };
  };

  try {
    const email = require("../lib/email");
    return await run({ email, calls });
  } finally {
    global.fetch = priorFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in priorEnv)) delete process.env[key];
    }
    Object.assign(process.env, priorEnv);
    clearReportGradeCache();
    for (const modulePath of mockedPaths) {
      delete require.cache[modulePath];
      const prior = priorModules.get(modulePath);
      if (prior) require.cache[modulePath] = prior;
    }
  }
}

function practiceInput({ dryRun, internalOwnerProof, persistCampaignLog = false }) {
  const deliveryEmail = internalOwnerProof ? OWNER_EMAIL : PROSPECT_EMAIL;
  return {
    prospect: {
      prospect_id: PROSPECT_ID,
      status: "new",
      business_name: "Boundary Business",
      city: "Irvine",
      state: "CA",
      industry: "plumbing",
      email: deliveryEmail,
      owner_email: deliveryEmail,
      preview_url: PREVIEW_URL,
      current_website: CURRENT_URL,
      before_shot_source_url: CURRENT_URL,
      report_url: REPORT_URL,
      email_verified: true,
      email_source: "website",
      record: {
        status: "new",
        email: deliveryEmail,
        email_verified: true,
        email_source: "website",
        genie_content_certification: {
          signature: CERT_SIGNATURE,
          identity: {
            business_name: "Boundary Business",
            canonical_domain: "boundarybusiness.test",
            city: "Irvine",
            state: "CA",
            category: "plumbing",
          },
        },
        proof_shots: {
          build_hash: "a".repeat(64),
          old_shot_sha: "b".repeat(64),
          old_captured_url: CURRENT_URL,
          new_shot_sha: "d".repeat(64),
          new_captured_url: PREVIEW_URL,
        },
        build_ready: {
          mirror_request: {
            content: {
              reviews: [{
                author: "Verified Customer",
                text: "Fast, careful work and a clean finish.",
                rating: 5,
                avatarUrl: REVIEWER_FACE,
              }],
            },
          },
        },
      },
    },
    sequence: 1,
    step: 1,
    dryRun,
    internalOwnerProof,
    lineBatchApproved: internalOwnerProof,
    requireSignalReportInEmail: internalOwnerProof,
    ...(internalOwnerProof ? {
      verifyOwnerPracticeReceipt: (_prospect, record) => ({
        ok: true,
        receipt: record.genie_content_certification,
      }),
      sourceRecipientEmail: PROSPECT_EMAIL,
      requireCanonicalRecipientGuard: true,
      allowReviewHoldBypass: true,
      allowDeliveryPauseBypass: true,
      allowContactHoldBypass: true,
    } : {}),
    persistCampaignLog,
  };
}

test("owner Practice dry-run is read-only before reviewer-face and dashboard helpers", async () => {
  await withHarness(async ({ email, calls }) => {
    const result = await email.sendSequenceStep(practiceInput({
      dryRun: true,
      internalOwnerProof: true,
    }));

    assert.equal(result.mode, "dry_run", JSON.stringify(result));
    assert.equal(calls.report.length, 1, "the test must exercise the owner Practice Signal path");
    assert.equal(calls.mirrorReviewFace.length, 0, "dry-run must not re-host reviewer faces");
    assert.equal(calls.prospectMagicLink.length, 0, "dry-run must not provision dashboard access");
    assert.equal(calls.upsert.length, 0, "dry-run must not write through the store");
    assert.equal(calls.provider.length, 0, "dry-run must not call the email provider");
  });
});

test("real owner Practice never provisions or rebinds the prospect dashboard", async () => {
  await withHarness(async ({ email, calls }) => {
    const result = await email.sendSequenceStep(practiceInput({
      dryRun: false,
      internalOwnerProof: true,
    }));

    assert.equal(result.mode, "sent", JSON.stringify(result));
    assert.equal(calls.prospectMagicLink.length, 0, "owner proof must not touch the prospect dashboard row");
    assert.equal(calls.upsert.length, 0, "owner proof must not rebind dashboard data through the store");
    assert.equal(calls.provider.length, 1);
    assert.equal(calls.provider[0].body.to, OWNER_EMAIL);
  });
});

// ---------------------------------------------------------------------------
// DURABLE OWNER-PROOF ACCOUNTING (2026-09-03)
//
// The 42 owner-proof emails the Line lane delivered after Aug 31 left NO
// durable record: sendSequenceStep gated BOTH the ghost_agency_email_log
// upsert and the send event behind `!internalOwnerProof`, so every real
// owner-proof delivery — queue settle, drain_emails, gallery resend — was
// invisible to durable accounting. These tests pin the fix: a real owner
// proof writes the marked email_log row AND the established proof event,
// exactly once, and accounting failures never fail a delivered send.
//
// The write is pinned at its ONLY choke point — sendSequenceStep — using the
// exact input the drain_emails path delivers (sequence 1, step 1, the
// ghost-line-* idempotency key, lineBatchApproved + requireSignalReportInEmail,
// persistCampaignLog defaulting on). The upstream links are pinned in their
// own suites: test/line-drain-emails.test.js proves the drain invokes the
// createLineSender sender per row with that same sequence/step, and
// test/line-delivery.test.js proves that sender hands sendSequenceStep the
// internalOwnerProof input keyed by batch+prospect+step.
// ---------------------------------------------------------------------------

const PROOF_SENT_EVENT_TYPE = "operator.mirror_proof_sent";

test("a real owner Practice send writes its durable email_log row, marked as owner-only", async () => {
  await withHarness(async ({ email, calls }) => {
    // The exact shape the Line lane delivers with: persistCampaignLog
    // defaults on (lib/line-delivery passes no override), sequence 1 step 1,
    // the provider idempotency key bound to batch+prospect+step.
    const result = await email.sendSequenceStep({
      ...practiceInput({ dryRun: false, internalOwnerProof: true, persistCampaignLog: true }),
      idempotencyKey: "ghost-line-sideeffects-0001",
    });

    assert.equal(result.mode, "sent", JSON.stringify(result));
    assert.equal(result.campaignLogPersisted, true);

    // BEFORE: zero rows. AFTER: exactly one marked row for this send.
    const logWrites = calls.upsert.filter(([table]) => table === "ghost_agency_email_log");
    assert.equal(logWrites.length, 1);
    const [table, row, conflict] = logWrites[0];
    assert.equal(table, "ghost_agency_email_log");
    assert.equal(row.prospect_id, PROSPECT_ID);
    assert.equal(row.sequence, 1);
    assert.equal(row.step, 1);
    assert.equal(row.mode, "sent");
    assert.equal(row.suppressed, false);
    // The markings the ledger, morning report, console and dedup readers
    // already expect: audit-visible, never campaign truth.
    assert.equal(row.payload.ownerProof, true);
    assert.equal(row.payload.sandbox, true);
    assert.equal(row.payload.deliveryLane, "owner_only_proof");
    assert.equal(row.payload.isProspectSend, false);
    assert.equal(conflict, "prospect_id,sequence,step");
    // No other store upsert happened (the prospect row itself is untouched).
    assert.equal(calls.upsert.length, 1);
  });
});

test("the same send is named in the established proof event channel, keyed idempotent", async () => {
  await withHarness(async ({ email, calls }) => {
    const result = await email.sendSequenceStep({
      ...practiceInput({ dryRun: false, internalOwnerProof: true, persistCampaignLog: true }),
      idempotencyKey: "ghost-line-sideeffects-0002",
    });

    assert.equal(result.mode, "sent", JSON.stringify(result));
    const eventWrites = calls.insertRow.filter(([table]) => table === "ghost_agency_events");
    assert.equal(eventWrites.length, 1, "exactly one proof event per send");
    const [table, event] = eventWrites[0];
    assert.equal(table, "ghost_agency_events");
    assert.equal(event.type, PROOF_SENT_EVENT_TYPE);
    assert.equal(event.svix_id, "ghost-line-sideeffects-0002", "the provider idempotency key dedups retries");
    assert.equal(event.payload.status, "sent");
    assert.equal(event.payload.prospect_id, PROSPECT_ID);
    assert.equal(event.payload.provider_receipt, "provider-side-effects");
    assert.equal(event.payload.owner_proof, true);
    assert.equal(event.payload.delivery_lane, "owner_only_proof");
    assert.equal(event.payload.preview_url, PREVIEW_URL);
  });
});

test("a refused proof-event write (already recorded / claim-owned svix key) never fails the send", async () => {
  await withHarness(async ({ email, calls }) => {
    // The store refuses the insert (duplicate svix_id — 23505). The email has
    // already been accepted by the provider; accounting stays fail-soft.
    calls.insertRowShouldConflict = true;
    const priorInsert = calls.insertRow;
    const result = await email.sendSequenceStep({
      ...practiceInput({ dryRun: false, internalOwnerProof: true, persistCampaignLog: true }),
      idempotencyKey: "ghost-line-sideeffects-0003",
    });

    assert.equal(result.mode, "sent", JSON.stringify(result));
    assert.equal(result.ok, true);
    assert.ok(priorInsert.length >= 0, "the conflict path is exercised through the mocked store");
  });
});

test("real prospect V3 still provisions its dashboard exactly once", async () => {
  await withHarness(async ({ email, calls }) => {
    const result = await email.sendSequenceStep(practiceInput({
      dryRun: false,
      internalOwnerProof: false,
    }));

    assert.equal(result.mode, "sent", JSON.stringify(result));
    assert.equal(calls.prospectMagicLink.length, 1);
    assert.equal(calls.prospectMagicLink[0].email, PROSPECT_EMAIL);
    assert.equal(calls.provider.length, 1);
    assert.equal(calls.provider[0].body.to, PROSPECT_EMAIL);
  });
});
