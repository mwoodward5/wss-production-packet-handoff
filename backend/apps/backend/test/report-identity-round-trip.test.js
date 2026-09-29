"use strict";

// ---------------------------------------------------------------------------
// test/report-identity-round-trip.test.js — THE REPORT SERVER IDENTITY ROUND-TRIP.
//
// Issue #595. Rows saved through the immutable CallPrep adapter refused at
// email time with owner_proof_signal_report_identity_mismatch:<field>:act:<8>.
// The verdict lives in ownerPracticeReportIdentityVerdict (lib/email.js) and is
// deliberately NOT exported — requiring the composer would drag the whole send
// path into this suite — so its seven-field comparison is mirrored below from
// the same exported normalizers (normalizeBusinessName / normalizeDomain), and
// the REAL verdict is additionally driven end-to-end through sendSequenceStep
// in the final test by capturing the owner-law soft-warn it emits on mismatch.
//
// The round under test is the production one:
//
//   immutablePacketAdapter          (lib/line-report.js)
//     -> saveBusinessReport/postImmutableRow  (lib/callprep-client.js)
//     -> [the CallPrep server: persists the POSTed report row keyed by
//         externalId, serves the stored row back on GET get-business-report]
//     -> fetchReportFacts            (lib/report-grade.js)
//     -> the owner-proof report identity verdict
//
// The server is a stub that does exactly what the edge-function pair
// contractually does: store the posted report verbatim, serve it back by id.
// Any field the writer drops therefore fails HERE, not in production.
// ---------------------------------------------------------------------------

const assert = require("node:assert/strict");
const test = require("node:test");

const { immutablePacketAdapter, ensureLineReport } = require("../lib/line-report");
const { saveBusinessReport } = require("../lib/callprep-client");
const { fetchReportFacts, clearReportGradeCache } = require("../lib/report-grade");
const { normalizeBusinessName, normalizeDomain } = require("../lib/prospect-identity");

const REPORT_ID = "5d4b3c2a-1e6f-4a7b-8c9d-0f1e2a3b4c5d";
const REPORT_URL = `https://callprep.wss-ai.com/report/${REPORT_ID}`;
const ADAPTER_ORIGIN = "https://callprep-project.supabase.co";
const READ_ORIGIN = "https://qjiszykrgqdwlvooicvk.supabase.co";
const SIGNATURE = "a".repeat(64);
const PACKET_TOKEN = `wss-genie-cert-v1:${SIGNATURE}`;
const SECURE_SECRET = "test-secret-with-at-least-thirty-two-bytes";
const NOW_MS = 1750000000000;

const ENV = Object.freeze({
  CALLPREP_SUPABASE_URL: READ_ORIGIN,
  CALLPREP_SUPABASE_ANON_KEY: "anon-jwt-for-tests",
  CALLPREP_GHOST_ADAPTER_URL: `${ADAPTER_ORIGIN}/functions/v1/ghost-report-adapter`,
  GHOST_REPORT_ADAPTER_HMAC_SECRET: SECURE_SECRET,
});

/**
 * A Practice prospect whose mutable website deliberately disagrees with the
 * certified receipt: the receipt is the only authority for the signed domain,
 * so the saved row must serve the SIGNED domain, never the stale mutable URL.
 */
function certifiedProspect(overrides = {}) {
  return {
    prospect_id: "place_47b4505c25f5c597780d8a82ef084ad6",
    business_name: "RiverCity Plumbing",
    current_website: "https://stale-mutable-site.example/",
    city: "Jacksonville",
    state: "FL",
    record: {
      genie_canonical_packet: {
        ok: true,
        version: "intake-genie-v2",
        status: "complete",
        scope: { supported: true, category: "plumbing" },
        facts: {
          name: "RiverCity Plumbing",
          city: "Jacksonville",
          state: "FL",
          category: "plumbing",
        },
      },
    },
    ...overrides,
  };
}

function certifiedReceipt(identityOverrides = {}) {
  return {
    signature: SIGNATURE,
    identity: {
      business_name: "RiverCity Plumbing",
      canonical_domain: "rivercityplumbingjax.com",
      city: "Jacksonville",
      state: "FL",
      category: "plumbing",
      ...identityOverrides,
    },
    evidence: { source_bound: true },
  };
}

/**
 * The CallPrep server pair as a fetch stub: POST ghost-report-adapter stores
 * the report row by externalId; GET get-business-report serves the stored row.
 *
 * `dropTopLevelWebsiteColumns` simulates a read projection that loses the
 * top-level website columns while preserving source_snapshot verbatim — the
 * belt the writer/reader must survive for the identity to round-trip.
 */
function callPrepServerStub({ dropTopLevelWebsiteColumns = false } = {}) {
  const rows = new Map();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, options });
    if (target.startsWith(`${ADAPTER_ORIGIN}/functions/v1/ghost-report-adapter`)) {
      const body = JSON.parse(options.body);
      rows.set(body.externalId, body.report);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, mode: "created", reportId: REPORT_ID }),
      };
    }
    if (target.startsWith(`${READ_ORIGIN}/functions/v1/get-business-report`)) {
      const id = new URL(target).searchParams.get("id");
      const row = rows.get(PACKET_TOKEN);
      if (!row || id !== REPORT_ID) {
        return {
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ error: "Report not found" }),
        };
      }
      const served = dropTopLevelWebsiteColumns
        ? { ...row, business_url: null, businessUrl: undefined, website_url: null, websiteUrl: undefined }
        : row;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { ...served, id } }),
      };
    }
    throw new Error(`unexpected fetch in report round-trip: ${target}`);
  };
  return { fetchImpl, calls, rows };
}

// ---------------------------------------------------------------------------
// THE VERDICT MIRROR
//
// Faithful copy of ownerPracticeReportIdentityVerdict from lib/email.js (which
// must not be edited for this fix and is not exported). The seven compared
// fields, their normalizers, and the refusal reason format must stay
// identical; the final test drives the real verdict as a cross-check.
// ---------------------------------------------------------------------------

function mirroredOwnerPracticeReportIdentityVerdict(reportRead, receipt = null) {
  const receiptIdentity = receipt && typeof receipt.identity === "object"
    && !Array.isArray(receipt.identity)
    ? receipt.identity
    : null;
  const reportIdentity = reportRead && typeof reportRead.identity === "object"
    && !Array.isArray(reportRead.identity)
    ? reportRead.identity
    : null;
  const signature = String(receipt && receipt.signature || "").trim().toLowerCase();
  if (!receiptIdentity || !reportIdentity || !/^[0-9a-f]{64}$/.test(signature)) {
    return { ok: false, reason: "owner_proof_signal_report_identity_missing" };
  }

  const fold = (value) => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  const expectedName = normalizeBusinessName(receiptIdentity.business_name);
  const reportName = normalizeBusinessName(reportIdentity.businessName);
  const snapshotName = normalizeBusinessName(reportIdentity.snapshotBusinessName);
  const expectedDomain = normalizeDomain(receiptIdentity.canonical_domain);
  const reportDomain = normalizeDomain(reportIdentity.businessUrl);
  const expectedToken = `wss-genie-cert-v1:${signature}`;
  const missing = !expectedName || !reportName || !snapshotName
    || !String(reportIdentity.packetId || "").trim();
  if (missing) return { ok: false, reason: "owner_proof_signal_report_identity_missing" };

  const fp = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "empty";
  const mismatched = [
    ["packetId", reportIdentity.packetId !== expectedToken, expectedToken, reportIdentity.packetId],
    ["businessName", reportName !== expectedName, expectedName, reportName],
    ["snapshotBusinessName", snapshotName !== expectedName, expectedName, snapshotName],
    ["businessUrl", reportDomain !== expectedDomain, expectedDomain, reportDomain],
    ["city", fold(reportIdentity.city) !== fold(receiptIdentity.city), receiptIdentity.city, reportIdentity.city],
    ["state", String(reportIdentity.state || "").trim().toUpperCase()
      !== String(receiptIdentity.state || "").trim().toUpperCase(), receiptIdentity.state, reportIdentity.state],
    ["industry", fold(reportIdentity.industry) !== fold(receiptIdentity.category), receiptIdentity.category, reportIdentity.industry],
  ].find((entry) => entry[1] === true);
  return mismatched
    ? {
      ok: false,
      reason: `owner_proof_signal_report_identity_mismatch:${mismatched[0]}`
        + `:act:${fp(mismatched[3])}`,
    }
    : { ok: true, token: expectedToken };
}

// ---------------------------------------------------------------------------
// THE ROUND TRIP
// ---------------------------------------------------------------------------

async function saveImmutableRow(server, receipt) {
  const projected = immutablePacketAdapter(certifiedProspect(), {
    verifyGenieContentReceipt: () => ({ ok: true, receipt }),
  });
  assert.equal(projected.ok, true, JSON.stringify(projected));
  const saved = await saveBusinessReport(
    {
      adapter: projected.adapter,
      prospect: projected.prospect,
      immutablePacketId: projected.reportIdentity.packetId,
    },
    { env: ENV, fetch: server.fetchImpl, now: () => NOW_MS },
  );
  assert.equal(saved.ok, true, JSON.stringify(saved));
  return { projected, saved };
}

test("an immutable-packet row round-trips the exact signed identity through the report server", async () => {
  const receipt = certifiedReceipt();
  const server = callPrepServerStub();
  const { saved } = await saveImmutableRow(server, receipt);

  const reportRead = await fetchReportFacts({
    reportUrl: saved.report_url,
    env: ENV,
    fetch: server.fetchImpl,
    cache: new Map(),
  });
  assert.equal(reportRead.reportExists, true, reportRead.reason);
  assert.ok(reportRead.identity, "the served row must carry identity");

  const verdict = mirroredOwnerPracticeReportIdentityVerdict(reportRead, receipt);
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
});

test("a signed website-less packet round-trips as a domainless identity", async () => {
  const receipt = certifiedReceipt({ canonical_domain: "" });
  const server = callPrepServerStub();
  const { saved } = await saveImmutableRow(server, receipt);

  const reportRead = await fetchReportFacts({
    reportUrl: saved.report_url,
    env: ENV,
    fetch: server.fetchImpl,
    cache: new Map(),
  });
  assert.equal(reportRead.reportExists, true, reportRead.reason);
  const servedRow = server.rows.get(PACKET_TOKEN);
  assert.equal(servedRow.business_url, null, "a domainless packet must stay domainless on the row");

  const verdict = mirroredOwnerPracticeReportIdentityVerdict(reportRead, receipt);
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
});

test("the served identity survives a read projection that drops the top-level website columns", async () => {
  const receipt = certifiedReceipt();
  const server = callPrepServerStub({ dropTopLevelWebsiteColumns: true });
  const { saved } = await saveImmutableRow(server, receipt);

  const reportRead = await fetchReportFacts({
    reportUrl: saved.report_url,
    env: ENV,
    fetch: server.fetchImpl,
    cache: new Map(),
  });
  assert.equal(reportRead.reportExists, true, reportRead.reason);

  const verdict = mirroredOwnerPracticeReportIdentityVerdict(reportRead, receipt);
  assert.equal(verdict.ok, true, JSON.stringify(verdict));
});

test("ensureLineReport completes the immutable Practice lane against a serving report server", async () => {
  const receipt = certifiedReceipt();
  const server = callPrepServerStub();
  const out = await ensureLineReport(certifiedProspect(), {
    preferImmutablePacket: true,
    deadlineAt: Date.now() + 120_000,
    deps: {
      verifyGenieContentReceipt: () => ({ ok: true, receipt }),
      saveBusinessReport: (input, options) => saveBusinessReport(input, {
        ...options,
        env: ENV,
        fetch: server.fetchImpl,
        now: () => NOW_MS,
      }),
      fetchReportFacts: (args) => fetchReportFacts({
        ...args,
        env: ENV,
        fetch: server.fetchImpl,
        cache: new Map(),
      }),
      scanBusiness: async () => {
        throw new Error("immutable Practice must not scan");
      },
    },
  });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.mode, "immutable_packet");
  assert.equal(out.reportUrl, REPORT_URL);
});

// ---------------------------------------------------------------------------
// THE REAL VERDICT, THROUGH THE COMPOSER
//
// The owner law makes an internal-owner Practice mismatch a loud console.warn
// (owner_proof_report_identity_soft_block) instead of a block. A round-tripped
// row must produce NO identity warning at compose or boundary time — that is
// the observable form of ownerPracticeReportIdentityVerdict(...).ok === true
// through the real, unedited lib/email.js.
// ---------------------------------------------------------------------------

test("the real owner-proof verdict accepts the round-tripped row at compose time", async () => {
  const emailPath = require.resolve("../lib/email");
  const storePath = require.resolve("../lib/store");
  const priorEmail = require.cache[emailPath];
  const priorStore = require.cache[storePath];
  const priorFetch = global.fetch;
  const priorWarn = console.warn;
  const priorEnv = { ...process.env };
  const receipt = certifiedReceipt();
  const server = callPrepServerStub();
  const warnings = [];
  const sourceEmail = "Prospect@RiverCityPlumbing.COM";
  const prospectId = "round-trip-practice-1";

  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@wss-ai.test";
  process.env.GHOST_AGENCY_OUTREACH_FROM = "WSS Labs <hello@go.wss-ai.com>";
  process.env.GHOST_AGENCY_RESEND_WEBHOOK_SECRET = "test-webhook-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.EMAIL_UNSUB_SECRET = "test-unsubscribe-secret";
  process.env.GHOST_AGENCY_PROOF_EMAIL_V3 = "0";
  process.env.GHOST_AGENCY_PROSPECT_SEND_ENABLED = "true";
  process.env.CALLPREP_SUPABASE_URL = READ_ORIGIN;
  process.env.CALLPREP_SUPABASE_ANON_KEY = "anon-jwt-for-tests";
  delete process.env.GHOST_AGENCY_REVIEW_HOLD;
  clearReportGradeCache();

  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      recordEvent: async () => ({ ok: true }),
      upsertRow: async () => ({ ok: true }),
      select: async (table) => {
        if (table === "ghost_agency_suppressions") return { ok: true, data: [] };
        if (table === "ghost_agency_prospects") {
          return {
            ok: true,
            data: [{
              prospect_id: prospectId,
              status: "new",
              email: sourceEmail,
              owner_email: null,
              record: {
                status: "new",
                email: sourceEmail,
                report_url: REPORT_URL,
                genie_content_certification: receipt,
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
    const target = String(url);
    if (target.startsWith(`${READ_ORIGIN}/functions/v1/get-business-report`)) {
      return server.fetchImpl(url, options);
    }
    if (target.startsWith("https://api.resend.com/")) {
      return { ok: true, status: 200, json: async () => ({ id: "provider-round-trip" }) };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
  };
  console.warn = (value) => { warnings.push(String(value)); };

  try {
    const { saved } = await saveImmutableRow(server, receipt);
    assert.equal(saved.report_url, REPORT_URL);

    const email = require("../lib/email");
    const result = await email.sendSequenceStep({
      prospect: {
        prospect_id: prospectId,
        status: "new",
        business_name: "RiverCity Plumbing",
        city: "Jacksonville",
        industry: "plumbing",
        email: "owner@wss-ai.test",
        owner_email: "owner@wss-ai.test",
        record: {
          status: "new",
          email: "owner@wss-ai.test",
          genie_content_certification: receipt,
        },
        preview_url: "https://rivercity-plumbing.wss-ai.com/",
        current_website: "https://stale-mutable-site.example/",
        before_shot_source_url: "https://stale-mutable-site.example/",
        report_url: REPORT_URL,
      },
      sequence: 1,
      step: 1,
      dryRun: false,
      internalOwnerProof: true,
      sourceRecipientEmail: sourceEmail,
      requireCanonicalRecipientGuard: true,
      allowReviewHoldBypass: true,
      allowDeliveryPauseBypass: true,
      allowContactHoldBypass: true,
      lineBatchApproved: true,
      requireSignalReportInEmail: true,
      verifyOwnerPracticeReceipt: (_prospect, record) => ({
        ok: true,
        receipt: record.genie_content_certification,
      }),
      persistCampaignLog: false,
    });

    assert.equal(result.mode, "sent", JSON.stringify(result));
    const identityWarnings = warnings.filter((line) => line.includes("owner_proof_report_identity_soft_block"));
    assert.deepEqual(
      identityWarnings,
      [],
      "the real ownerPracticeReportIdentityVerdict refused the round-tripped row",
    );
  } finally {
    console.warn = priorWarn;
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
});
