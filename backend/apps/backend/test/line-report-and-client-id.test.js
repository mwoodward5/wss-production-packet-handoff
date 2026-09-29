"use strict";

// test/line-report-and-client-id.test.js
//
// Three things the owner asked to be rolled in, pinned:
//   1. the Signal report is generated for a line prospect and LINKED in the email
//   2. the Client ID prints even though the mirror lane never writes one
//   3. Riley can resolve that same code — the email and the lookup must agree

const test = require("node:test");
const assert = require("node:assert");
const { ensureLineReport, scanKeyFor } = require("../lib/line-report");
const { buildCallPrepRow } = require("../lib/callprep-client");
const { clientReferenceCode } = require("../lib/client-reference");
const { outreachHtmlV2 } = require("../lib/outreach-email-v2");
const { clearReportGradeCache } = require("../lib/report-grade");

const PROSPECT = {
  prospect_id: "place_47b4505c25f5c597780d8a82ef084ad6",
  business_name: "RiverCity Plumbing",
  city: "Jacksonville",
  state: "FL",
  current_website: "https://rivercityplumbingjax.com/",
};
const CERT_SIGNATURE = "a".repeat(64);
const CERT_PACKET_ID = `wss-genie-cert-v1:${CERT_SIGNATURE}`;

function practiceProspect(overrides = {}) {
  return {
    ...PROSPECT,
    ...overrides,
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
      ...(overrides.record || {}),
    },
  };
}

function verifiedReceipt(overrides = {}) {
  return {
    ok: true,
    receipt: {
      signature: CERT_SIGNATURE,
      identity: {
        business_name: "RiverCity Plumbing",
        canonical_domain: "rivercityplumbingjax.com",
        city: "Jacksonville",
        state: "FL",
        category: "plumbing",
      },
      evidence: { source_bound: true },
      ...overrides,
    },
  };
}

function matchingReportIdentity(overrides = {}) {
  return {
    packetId: CERT_PACKET_ID,
    businessName: "RiverCity Plumbing",
    businessUrl: "https://rivercityplumbingjax.com/",
    ...overrides,
  };
}

test("the scan key prefers their real website over a name string", () => {
  assert.equal(scanKeyFor(PROSPECT), "https://rivercityplumbingjax.com/");
  assert.equal(
    scanKeyFor({ business_name: "Acme Plumbing", city: "Austin", state: "TX" }),
    "Acme Plumbing Austin TX",
  );
});

test("an existing report is reused, never re-minted", async () => {
  const out = await ensureLineReport(PROSPECT, {
    deps: {
      existingCallPrepReportUrl: () => "https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc",
      scanBusiness: async () => { throw new Error("must not scan"); },
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.mode, "existing");
  assert.equal(out.reportUrl, "https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc");
});

test("Practice reuses only an exact signed-packet report identity and performs zero static POSTs", async () => {
  let reads = 0;
  let scans = 0;
  let saves = 0;
  const reportUrl = "https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc";
  const out = await ensureLineReport(practiceProspect(), {
    preferImmutablePacket: true,
    deps: {
      existingCallPrepReportUrl: () => reportUrl,
      fetchReportFacts: async ({ reportUrl: requested }) => {
        reads += 1;
        assert.equal(requested, reportUrl);
        return {
          ok: false,
          facts: null,
          reportExists: true,
          identity: matchingReportIdentity(),
          reason: "ungraded",
        };
      },
      verifyGenieContentReceipt: () => verifiedReceipt(),
      scanBusiness: async () => { scans += 1; },
      saveBusinessReport: async () => { saves += 1; },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.mode, "existing");
  assert.equal(out.reportUrl, reportUrl);
  assert.equal(reads, 1);
  assert.equal(scans, 0);
  assert.equal(saves, 0);
});

test("Practice preserves a genuinely website-less report when both signed identities are domainless", async () => {
  let saves = 0;
  const prospect = practiceProspect({ current_website: "" });
  const out = await ensureLineReport(prospect, {
    preferImmutablePacket: true,
    deps: {
      existingCallPrepReportUrl: () => "https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc",
      fetchReportFacts: async () => ({
        reportExists: true,
        identity: matchingReportIdentity({ businessUrl: "" }),
      }),
      verifyGenieContentReceipt: () => verifiedReceipt({
        identity: {
          ...verifiedReceipt().receipt.identity,
          canonical_domain: "",
        },
      }),
      saveBusinessReport: async () => { saves += 1; },
    },
  });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.mode, "existing");
  assert.equal(saves, 0);
});

test("a signed domainless packet omits Signal website identity despite a stale mutable prospect URL", async () => {
  const staleWebsite = "https://stale-before.example/";
  const reportUrl = "https://callprep.wss-ai.com/report/7f861376-5304-4f47-9d63-1129af8dfe24";
  const domainlessReceipt = verifiedReceipt({
    identity: {
      ...verifiedReceipt().receipt.identity,
      canonical_domain: "",
    },
  });
  const prospect = practiceProspect({
    current_website: staleWebsite,
    website: staleWebsite,
    record: {
      current_website: staleWebsite,
      website: staleWebsite,
    },
  });
  let savedProspect = null;
  let savedRow = null;
  let saves = 0;
  const out = await ensureLineReport(prospect, {
    preferImmutablePacket: true,
    deps: {
      verifyGenieContentReceipt: () => domainlessReceipt,
      scanBusiness: async () => { throw new Error("immutable Practice must not scan"); },
      saveBusinessReport: async ({ adapter, prospect: packetProspect }) => {
        saves += 1;
        savedProspect = packetProspect;
        savedRow = buildCallPrepRow({ adapter, prospect: packetProspect });
        return { ok: true, report_url: reportUrl };
      },
      fetchReportFacts: async ({ reportUrl: requested }) => {
        assert.equal(requested, reportUrl);
        return {
          reportExists: true,
          identity: matchingReportIdentity({ businessUrl: "" }),
        };
      },
    },
  });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.mode, "immutable_packet");
  assert.equal(saves, 1);
  assert.equal(Object.hasOwn(savedProspect, "current_website"), false);
  assert.equal(Object.hasOwn(savedProspect, "website"), false);
  assert.equal(savedRow.business_url, null, "CallPrep receives no website for the signed domainless identity");
  assert.equal(prospect.current_website, staleWebsite, "projection does not mutate the durable source row");
  assert.equal(prospect.record.current_website, staleWebsite);
});

test("Practice holds a reused report with missing or mismatched signed identity and performs zero POSTs", async () => {
  const reportUrl = "https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc";
  const cases = [
    ["missing identity", null, "existing_report_identity_missing"],
    ["missing token", matchingReportIdentity({ packetId: "" }), "existing_report_identity_missing"],
    ["wrong token", matchingReportIdentity({ packetId: `wss-genie-cert-v1:${"b".repeat(64)}` }), "existing_report_identity_mismatch"],
    ["wrong name", matchingReportIdentity({ businessName: "Other Plumbing" }), "existing_report_identity_mismatch"],
    ["missing domain", matchingReportIdentity({ businessUrl: "" }), "existing_report_identity_mismatch"],
    ["invalid domain", matchingReportIdentity({ businessUrl: "javascript:alert(1)" }), "existing_report_identity_mismatch"],
    ["wrong domain", matchingReportIdentity({ businessUrl: "https://other.example/" }), "existing_report_identity_mismatch"],
  ];

  for (const [label, identity, reason] of cases) {
    let saves = 0;
    const out = await ensureLineReport(practiceProspect(), {
      preferImmutablePacket: true,
      deps: {
        existingCallPrepReportUrl: () => reportUrl,
        fetchReportFacts: async () => ({ reportExists: true, identity }),
        verifyGenieContentReceipt: () => verifiedReceipt(),
        saveBusinessReport: async () => { saves += 1; },
      },
    });

    assert.equal(out.ok, false, label);
    assert.equal(out.reportUrl, "", label);
    assert.equal(out.reason, reason, label);
    assert.equal(out.reconciliationRequired, true, label);
    assert.equal(saves, 0, label);
  }
});

test("Practice holds an unavailable existing report read and performs zero POSTs", async () => {
  let saves = 0;
  const out = await ensureLineReport(practiceProspect(), {
    preferImmutablePacket: true,
    deps: {
      existingCallPrepReportUrl: () => "https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc",
      fetchReportFacts: async () => ({ reportExists: null, identity: null, reason: "unavailable" }),
      verifyGenieContentReceipt: () => verifiedReceipt(),
      saveBusinessReport: async () => { saves += 1; },
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.reason, "existing_report_availability_unknown");
  assert.equal(out.reconciliationRequired, true);
  assert.equal(saves, 0);
});

test("Practice holds a thrown CallPrep candidate lookup and performs zero POSTs", async () => {
  let saves = 0;
  const out = await ensureLineReport(practiceProspect(), {
    preferImmutablePacket: true,
    deps: {
      existingCallPrepReportUrl: () => "https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc",
      fetchReportFacts: async () => { throw new Error("lookup failed"); },
      verifyGenieContentReceipt: () => verifiedReceipt(),
      saveBusinessReport: async () => { saves += 1; },
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.reason, "existing_report_lookup_unavailable");
  assert.equal(out.reconciliationRequired, true);
  assert.equal(saves, 0);
});

test("Practice holds unreadable or invalid stored report references before any POST", async () => {
  const cases = [
    {
      label: "lookup throws",
      prospect: practiceProspect(),
      existingCallPrepReportUrl: () => { throw new Error("read failed"); },
      reason: "existing_report_lookup_unavailable",
    },
    {
      label: "stored slug is not a canonical report",
      prospect: practiceProspect({ report_url: "https://callprep.wss-ai.com/report/rivercity-plumbing" }),
      existingCallPrepReportUrl: undefined,
      reason: "existing_report_reference_invalid",
    },
    {
      label: "stored report reference has a non-string shape",
      prospect: practiceProspect({ report_url: { id: "not-a-url" } }),
      existingCallPrepReportUrl: undefined,
      reason: "existing_report_reference_invalid",
    },
    {
      label: "noncanonical CallPrep-like host is ambiguous, not foreign",
      prospect: practiceProspect({
        report_url: "https://www.callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc",
      }),
      existingCallPrepReportUrl: undefined,
      reason: "existing_report_reference_invalid",
    },
  ];

  for (const item of cases) {
    let reads = 0;
    let saves = 0;
    const deps = {
      verifyGenieContentReceipt: () => verifiedReceipt(),
      fetchReportFacts: async () => { reads += 1; },
      saveBusinessReport: async () => { saves += 1; },
      ...(item.existingCallPrepReportUrl
        ? { existingCallPrepReportUrl: item.existingCallPrepReportUrl }
        : {}),
    };
    const out = await ensureLineReport(item.prospect, { preferImmutablePacket: true, deps });
    assert.equal(out.ok, false, item.label);
    assert.equal(out.reason, item.reason, item.label);
    assert.equal(out.reconciliationRequired, true, item.label);
    assert.equal(reads, 0, item.label);
    assert.equal(saves, 0, item.label);
  }
});

test("Practice holds a definitively missing canonical CallPrep reference without POSTing a replacement", async () => {
  let reads = 0;
  let scans = 0;
  let saves = 0;
  const oldUrl = "https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc";
  const out = await ensureLineReport(practiceProspect(), {
    preferImmutablePacket: true,
    deps: {
      existingCallPrepReportUrl: () => oldUrl,
      fetchReportFacts: async () => { reads += 1; return { reportExists: false, reason: "not_found" }; },
      scanBusiness: async () => { scans += 1; },
      verifyGenieContentReceipt: () => verifiedReceipt({ evidence: { source_bound: false } }),
      saveBusinessReport: async () => { saves += 1; },
    },
  });

  assert.equal(out.ok, false, JSON.stringify(out));
  assert.equal(out.mode, "existing");
  assert.equal(out.reportUrl, "");
  assert.equal(out.reason, "existing_report_identity_no_match");
  assert.equal(out.reconciliationRequired, true);
  assert.equal(reads, 1);
  assert.equal(scans, 0);
  assert.equal(saves, 0);
});

test("Practice ignores a foreign legacy preview URL and mints one verified canonical Signal", async () => {
  let saves = 0;
  let reads = 0;
  const freshUrl = "https://callprep.wss-ai.com/report/d41f8a37-6b25-4e19-9c73-8f2a0d6b4e15";
  const out = await ensureLineReport(practiceProspect({
    report_url: "https://wss-test-rivercity.wss-ai.com/legacy-signal",
  }), {
    preferImmutablePacket: true,
    deps: {
      verifyGenieContentReceipt: () => verifiedReceipt(),
      saveBusinessReport: async ({ adapter, immutablePacketId }) => {
        saves += 1;
        assert.equal(adapter.packet.id, CERT_PACKET_ID);
        assert.equal(immutablePacketId, CERT_PACKET_ID);
        return { ok: true, report_url: freshUrl };
      },
      fetchReportFacts: async ({ reportUrl }) => {
        reads += 1;
        assert.equal(reportUrl, freshUrl);
        return { reportExists: true, identity: matchingReportIdentity() };
      },
    },
  });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.mode, "immutable_packet");
  assert.equal(out.reportUrl, freshUrl);
  assert.equal(saves, 1);
  assert.equal(reads, 1);
});

test("Practice enumerates top-level and record CallPrep URLs and reuses the one exact identity match", async () => {
  const staleUrl = "https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc";
  const exactUrl = "https://callprep.wss-ai.com/report/d41f8a37-6b25-4e19-9c73-8f2a0d6b4e15";
  const reads = [];
  let saves = 0;
  const out = await ensureLineReport(practiceProspect({
    report_url: staleUrl,
    record: { report_url: exactUrl },
  }), {
    preferImmutablePacket: true,
    deps: {
      verifyGenieContentReceipt: () => verifiedReceipt(),
      fetchReportFacts: async ({ reportUrl }) => {
        reads.push(reportUrl);
        return {
          reportExists: true,
          identity: reportUrl === exactUrl
            ? matchingReportIdentity()
            : matchingReportIdentity({ packetId: `wss-genie-cert-v1:${"b".repeat(64)}` }),
        };
      },
      saveBusinessReport: async () => { saves += 1; },
    },
  });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.reportUrl, exactUrl);
  assert.deepEqual(reads, [staleUrl, exactUrl]);
  assert.equal(saves, 0);
});

test("Practice blocks when multiple canonical CallPrep rows match the signed packet", async () => {
  const firstUrl = "https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc";
  const secondUrl = "https://callprep.wss-ai.com/report/d41f8a37-6b25-4e19-9c73-8f2a0d6b4e15";
  let saves = 0;
  const out = await ensureLineReport(practiceProspect({
    report_url: firstUrl,
    record: { report_url: secondUrl },
  }), {
    preferImmutablePacket: true,
    deps: {
      verifyGenieContentReceipt: () => verifiedReceipt(),
      fetchReportFacts: async () => ({ reportExists: true, identity: matchingReportIdentity() }),
      saveBusinessReport: async () => { saves += 1; },
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.reason, "existing_report_identity_ambiguous");
  assert.equal(out.reconciliationRequired, true);
  assert.equal(saves, 0);
});

test("Practice mints a neutral Signal from the certified immutable packet with zero scan calls", async () => {
  let scans = 0;
  let saves = 0;
  let savedRow = null;
  const prospect = {
    ...PROSPECT,
    rating: 2.1,
    review_count: 3,
    gaps: ["mutable red flag must not cross the packet boundary"],
    recommendations: ["mutable recommendation must not cross the packet boundary"],
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
          services: ["Drain Cleaning", "Water Heater Repair"],
        },
      },
    },
  };

  const out = await ensureLineReport(prospect, {
    preferImmutablePacket: true,
    deps: {
      scanBusiness: async () => { scans += 1; throw new Error("must not scan"); },
      verifyGenieContentReceipt: () => verifiedReceipt(),
      fetchReportFacts: async () => ({ reportExists: true, identity: matchingReportIdentity() }),
      saveBusinessReport: async ({ adapter, prospect: packetProspect, immutablePacketId }) => {
        saves += 1;
        assert.equal(immutablePacketId, CERT_PACKET_ID, "the verified packet token is the database idempotency key");
        savedRow = buildCallPrepRow({ adapter, prospect: packetProspect });
        return {
          ok: true,
          report_url: "https://callprep.wss-ai.com/report/d41f8a37-6b25-4e19-9c73-8f2a0d6b4e15",
        };
      },
    },
  });

  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.mode, "immutable_packet");
  assert.equal(scans, 0, "owner Practice must not run CallPrep gateway scans");
  assert.equal(saves, 1, "one static report row is minted");
  assert.equal(savedRow.business_name, "RiverCity Plumbing");
  assert.equal(savedRow.source_snapshot.packet_id, CERT_PACKET_ID);
  assert.equal(savedRow.source_snapshot.market, "Jacksonville, FL");
  assert.equal(savedRow.source_snapshot.industry, "plumbing");
  assert.deepEqual(savedRow.source_snapshot.requested_signals, [], "services are offerings, not Signal measurements");
  assert.equal(savedRow.overall_score, null, "mutable prospect ratings cannot fabricate a packet Signal grade");
  assert.equal(savedRow.overall_grade, null);
  assert.deepEqual(savedRow.issues_found, []);
  assert.deepEqual(savedRow.recommendations, []);
});

test("Practice verifies a newly created report identity before allowing email", async () => {
  const reportUrl = "https://callprep.wss-ai.com/report/d41f8a37-6b25-4e19-9c73-8f2a0d6b4e15";
  const cases = [
    ["wrong identity", { reportExists: true, identity: matchingReportIdentity({ businessName: "Other Co" }) }, "created_report_identity_mismatch"],
    ["unavailable", { reportExists: null, identity: null }, "created_report_availability_unknown"],
  ];

  for (const [label, availability, reason] of cases) {
    let saves = 0;
    const out = await ensureLineReport(practiceProspect(), {
      preferImmutablePacket: true,
      deps: {
        verifyGenieContentReceipt: () => verifiedReceipt(),
        saveBusinessReport: async () => { saves += 1; return { ok: true, report_url: reportUrl }; },
        fetchReportFacts: async () => availability,
      },
    });
    assert.equal(out.ok, false, label);
    assert.equal(out.reportUrl, reportUrl, label);
    assert.equal(out.persistReportUrl, reportUrl, label);
    assert.equal(out.reason, reason, label);
    assert.equal(out.reconciliationRequired, true, label);
    assert.equal(out.ambiguousSave, true, label);
    assert.equal(out.retryable, true, label);
    assert.equal(out.retryableBeforeProvider, true, label);
    assert.equal(saves, 1, label);
  }
});

test("an unavailable first read carries the created URL so retry verifies it with zero duplicate POSTs", async () => {
  let saves = 0;
  let reads = 0;
  const reportUrl = "https://callprep.wss-ai.com/report/d41f8a37-6b25-4e19-9c73-8f2a0d6b4e15";
  const deps = {
    verifyGenieContentReceipt: () => verifiedReceipt(),
    saveBusinessReport: async () => {
      saves += 1;
      return { ok: true, report_url: reportUrl };
    },
    fetchReportFacts: async ({ reportUrl: requested }) => {
      reads += 1;
      assert.equal(requested, reportUrl);
      return reads === 1
        ? { reportExists: null, identity: null, reason: "late_visibility" }
        : { reportExists: true, identity: matchingReportIdentity() };
    },
  };

  const first = await ensureLineReport(practiceProspect(), { preferImmutablePacket: true, deps });
  assert.equal(first.ok, false);
  assert.equal(first.reportUrl, reportUrl);
  assert.equal(first.persistReportUrl, reportUrl);
  assert.equal(first.retryableBeforeProvider, true);
  assert.equal(first.reconciliationRequired, true);
  assert.equal(saves, 1);

  // Model line-delivery's durable record write. The retry must now take the
  // existing-row GET path and can never create a second CallPrep row.
  const persisted = practiceProspect({ record: { report_url: first.persistReportUrl } });
  const second = await ensureLineReport(persisted, { preferImmutablePacket: true, deps });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.mode, "existing");
  assert.equal(second.reportUrl, reportUrl);
  assert.equal(saves, 1, "retry must not POST a duplicate report");
  assert.equal(reads, 2);
});

test("a newly created 404 is evicted so the persisted UUID retry observes the row without another POST", async () => {
  const priorFetch = global.fetch;
  const priorUrl = process.env.CALLPREP_SUPABASE_URL;
  const priorKey = process.env.CALLPREP_SUPABASE_ANON_KEY;
  const reportId = "d41f8a37-6b25-4e19-9c73-8f2a0d6b4e15";
  const reportUrl = `https://callprep.wss-ai.com/report/${reportId}`;
  let saves = 0;
  let reads = 0;
  clearReportGradeCache();
  process.env.CALLPREP_SUPABASE_URL = "https://qjiszykrgqdwlvooicvk.supabase.co";
  process.env.CALLPREP_SUPABASE_ANON_KEY = "test-callprep-key";
  global.fetch = async () => {
    reads += 1;
    if (reads === 1) return { status: 404, text: async () => "{}" };
    return {
      status: 200,
      text: async () => JSON.stringify({
        data: {
          id: reportId,
          business_name: "RiverCity Plumbing",
          business_url: "https://rivercityplumbingjax.com/",
          overall_grade: null,
          overall_score: null,
          source_snapshot: {
            packet_id: CERT_PACKET_ID,
            business_name: "RiverCity Plumbing",
            city: "Jacksonville",
            state: "FL",
            industry: "plumbing",
            categories: {},
          },
        },
      }),
    };
  };

  try {
    const deps = {
      verifyGenieContentReceipt: () => verifiedReceipt(),
      saveBusinessReport: async () => {
        saves += 1;
        return { ok: true, report_url: reportUrl };
      },
    };
    const first = await ensureLineReport(practiceProspect(), { preferImmutablePacket: true, deps });
    assert.equal(first.ok, false);
    assert.equal(first.persistReportUrl, reportUrl);
    assert.equal(first.retryableBeforeProvider, true);

    const second = await ensureLineReport(
      practiceProspect({ record: { report_url: first.persistReportUrl } }),
      { preferImmutablePacket: true, deps },
    );
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.reportUrl, reportUrl);
    assert.equal(saves, 1, "the persisted UUID retry must never POST again");
    assert.equal(reads, 2, "the cached 404 must be evicted before retry");
  } finally {
    global.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.CALLPREP_SUPABASE_URL;
    else process.env.CALLPREP_SUPABASE_URL = priorUrl;
    if (priorKey === undefined) delete process.env.CALLPREP_SUPABASE_ANON_KEY;
    else process.env.CALLPREP_SUPABASE_ANON_KEY = priorKey;
    clearReportGradeCache();
  }
});

test("concurrent immutable creates share one in-process POST and one verified result", async () => {
  let saves = 0;
  let reads = 0;
  const reportUrl = "https://callprep.wss-ai.com/report/d41f8a37-6b25-4e19-9c73-8f2a0d6b4e15";
  const saveBusinessReport = async () => {
    saves += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return { ok: true, report_url: reportUrl };
  };
  const options = {
    preferImmutablePacket: true,
    deps: {
      verifyGenieContentReceipt: () => verifiedReceipt(),
      saveBusinessReport,
      fetchReportFacts: async () => {
        reads += 1;
        return { reportExists: true, identity: matchingReportIdentity() };
      },
    },
  };

  const [first, second] = await Promise.all([
    ensureLineReport(practiceProspect(), options),
    ensureLineReport(practiceProspect(), options),
  ]);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(second, first);
  assert.equal(saves, 1);
  assert.equal(reads, 1);
});

test("Practice refuses an unverified immutable packet without scanning or saving", async () => {
  let scans = 0;
  let saves = 0;
  const out = await ensureLineReport({
    ...PROSPECT,
    record: { genie_canonical_packet: { facts: { name: "RiverCity Plumbing" } } },
  }, {
    preferImmutablePacket: true,
    deps: {
      scanBusiness: async () => { scans += 1; },
      saveBusinessReport: async () => { saves += 1; },
      verifyGenieContentReceipt: () => ({ ok: false, reason: "receipt_signature_invalid" }),
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.mode, "immutable_packet");
  assert.equal(out.reason, "immutable_packet_unverified:receipt_signature_invalid");
  assert.equal(scans, 0);
  assert.equal(saves, 0);
});

test("Practice refuses a verifier result without the signed identity token before any POST", async () => {
  let saves = 0;
  const out = await ensureLineReport(practiceProspect(), {
    preferImmutablePacket: true,
    deps: {
      verifyGenieContentReceipt: () => verifiedReceipt({ signature: "" }),
      saveBusinessReport: async () => { saves += 1; },
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.mode, "immutable_packet");
  assert.equal(out.reason, "immutable_packet_identity_token_missing");
  assert.equal(saves, 0);
});

test("an ambiguous immutable Signal save is surfaced for manual reconciliation, never retried here", async () => {
  let scans = 0;
  let saves = 0;
  const out = await ensureLineReport({
    ...PROSPECT,
    record: { genie_canonical_packet: { facts: { name: "RiverCity Plumbing" } } },
  }, {
    preferImmutablePacket: true,
    deps: {
      scanBusiness: async () => { scans += 1; },
      verifyGenieContentReceipt: () => verifiedReceipt({ evidence: { source_bound: false } }),
      saveBusinessReport: async () => {
        saves += 1;
        throw new Error("response lost after POST");
      },
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.ambiguousSave, true);
  assert.equal(out.mode, "immutable_packet");
  assert.equal(scans, 0);
  assert.equal(saves, 1);
});

test("a never-settling immutable save is bounded and parked for reconciliation", async () => {
  let saves = 0;
  const startedAt = Date.now();
  const out = await ensureLineReport(practiceProspect(), {
    preferImmutablePacket: true,
    deadlineAt: startedAt + 1_050,
    deps: {
      verifyGenieContentReceipt: () => verifiedReceipt(),
      saveBusinessReport: async () => {
        saves += 1;
        return new Promise(() => {});
      },
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.reason, "report_save_deadline");
  assert.equal(out.ambiguousSave, true);
  assert.equal(out.reconciliationRequired, true);
  assert.equal(saves, 1);
  assert.ok(Date.now() - startedAt < 2_000, "save exceeded its bounded deadline");
});

test("a stale slug report is not reused and a fresh UUID report replaces it", async () => {
  let scans = 0;
  let saves = 0;
  const fresh = "https://callprep.wss-ai.com/report/c93b71e5-2f48-4d6a-8b0c-1e7f9a3d5c62";
  const out = await ensureLineReport(PROSPECT, {
    deps: {
      existingCallPrepReportUrl: () => "https://callprep.wss-ai.com/report/rivercity-plumbing",
      scanBusiness: async () => { scans += 1; return { score: 32 }; },
      saveScannedBusinessReport: async () => { saves += 1; return { ok: true, report_url: fresh }; },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.reportUrl, fresh);
  assert.equal(out.mode, "live_scan");
  assert.equal(scans, 1);
  assert.equal(saves, 1);
});

test("an unsafe newly saved report URL is refused", async () => {
  const out = await ensureLineReport(PROSPECT, {
    deps: {
      existingCallPrepReportUrl: () => "",
      scanBusiness: async () => ({ score: 32 }),
      saveScannedBusinessReport: async () => ({ ok: true, report_url: "https://callprep.wss-ai.com/report/rivercity-plumbing" }),
    },
  });

  assert.equal(out.ok, false);
  assert.equal(out.reportUrl, "");
  assert.equal(out.reason, "invalid_report_url");
});

test("a live scan produces a report url", async () => {
  const out = await ensureLineReport(PROSPECT, {
    deps: {
      existingCallPrepReportUrl: () => "",
      scanBusiness: async ({ input }) => ({ input, score: 32 }),
      saveScannedBusinessReport: async () => ({ ok: true, report_url: "https://callprep.wss-ai.com/report/c93b71e5-2f48-4d6a-8b0c-1e7f9a3d5c62" }),
    },
  });
  assert.equal(out.reportUrl, "https://callprep.wss-ai.com/report/c93b71e5-2f48-4d6a-8b0c-1e7f9a3d5c62");
  assert.equal(out.mode, "live_scan");
});

test("a failed scan falls back to the static packet, and a failed save is FAIL-SOFT", async () => {
  let fallbackAdapter = null;
  const fellBack = await ensureLineReport(PROSPECT, {
    deps: {
      existingCallPrepReportUrl: () => "",
      scanBusiness: async () => { throw new Error("gateway down"); },
      saveBusinessReport: async ({ adapter }) => {
        fallbackAdapter = adapter;
        return { ok: true, report_url: "https://callprep.wss-ai.com/report/d41f8a37-6b25-4e19-9c73-8f2a0d6b4e15" };
      },
    },
  });
  assert.equal(fellBack.reportUrl, "https://callprep.wss-ai.com/report/d41f8a37-6b25-4e19-9c73-8f2a0d6b4e15");
  assert.match(fellBack.mode, /static_fallback/);
  assert.deepEqual(fallbackAdapter.packet, {
    id: null,
    businessName: "RiverCity Plumbing",
    market: "Jacksonville, FL",
    industry: null,
    requestedSignals: [],
  });

  const died = await ensureLineReport(PROSPECT, {
    deps: {
      existingCallPrepReportUrl: () => "",
      scanBusiness: async () => { throw new Error("down"); },
      saveBusinessReport: async () => { throw new Error("save exploded"); },
    },
  });
  assert.equal(died.ok, false);
  assert.equal(died.reportUrl, "", "a broken report must yield no link, not a broken one");
});

test("the email prints the Client ID and links the report", () => {
  const clientId = clientReferenceCode(PROSPECT);
  assert.match(clientId, /^WSS-[0-9A-F]{6}$/);

  const html = outreachHtmlV2({
    businessName: "RiverCity Plumbing",
    city: "Jacksonville",
    previewUrl: "https://wss-test-rivercity.wss-ai.com/",
    currentUrl: "https://rivercityplumbingjax.com/",
    beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=old",
    afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=new",
    clientId,
    reportUrl: "https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc",
  });

  assert.ok(html.includes(clientId), "the Client ID must be printed for Riley");
  assert.match(html, /mention this when you call Riley/i);
  assert.ok(html.includes("https://callprep.wss-ai.com/report/a127cdfa-b68b-4841-919c-7b35bfc95adc"), "the report must be linked");
  assert.match(html, /Read your report/);
});

test("no report url collapses the block rather than leaving a dead link", () => {
  const html = outreachHtmlV2({
    businessName: "RiverCity Plumbing",
    city: "Jacksonville",
    previewUrl: "https://wss-test-rivercity.wss-ai.com/",
    currentUrl: "https://rivercityplumbingjax.com/",
    beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=old",
    afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=new",
    clientId: clientReferenceCode(PROSPECT),
    reportUrl: "",
  });
  assert.ok(!html.includes("{SIGNAL_REPORT_BLOCK}"), "the placeholder must never survive into a sent email");
  assert.ok(!/Read your report/.test(html));
});

test("the Client ID the email prints is the one Riley recomputes", () => {
  // Riley resolves a spoken code by recomputing it over candidate rows; if the
  // email derived it from a different seed the caller would read back a code
  // that matches nobody.
  const fromEmailPath = clientReferenceCode({ ...PROSPECT, record: {} });
  const fromLookupPath = clientReferenceCode({ prospect_id: PROSPECT.prospect_id });
  assert.equal(fromEmailPath, fromLookupPath);
});
