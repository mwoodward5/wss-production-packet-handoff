"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  contactSendGate,
  enrichContactEvidence,
  enrichPublicContacts,
  normalizeEmail,
  normalizePhone,
  normalizeSourceType,
} = require("../lib/contact-enrichment");

const NOW = "2026-07-18T12:00:00.000Z";

test("normalizers reject malformed contact data instead of inventing replacements", () => {
  assert.equal(normalizeEmail("not an email"), "");
  assert.equal(normalizePhone("555"), "");
  assert.equal(normalizeEmail(" Owner@Example.COM "), "owner@example.com");
  assert.equal(normalizePhone("(214) 555-0199"), "+12145550199");
});

test("email normalization removes encoded leading whitespace and rejects miner junk domains", () => {
  assert.equal(normalizeEmail("%20roofing@example.org"), "roofing@example.org");
  assert.equal(normalizeEmail("MAILTO:%20Roofing@Example.org"), "roofing@example.org");
  assert.equal(normalizeEmail("605@sentry-next.wixpress.com"), "");
  assert.equal(normalizeEmail("events@sentry.io"), "");
  assert.equal(normalizeEmail("site@wix.com"), "");
  assert.equal(normalizeEmail("image@business.png"), "");
  assert.equal(normalizeEmail("hello@real-roofing-company.com"), "hello@real-roofing-company.com");
});

test("records provenance from every approved source and deduplicates contacts", () => {
  const result = enrichContactEvidence({
    observed_at: NOW,
    sources: {
      website: { url: "https://ink.example/contact", email: "studio@ink.example" },
      gbp: { url: "https://google.example/maps/1", email: "studio@ink.example", phone: "214-555-0199" },
      facebook: { url: "https://facebook.example/ink", phone: "(214) 555-0199" },
      instagram: { url: "https://instagram.example/ink" },
      public_directory: { url: "https://directory.example/ink", email: "bad value" }
    }
  });

  assert.equal(result.contacts.length, 2);
  assert.equal(result.contacts.find((row) => row.kind === "email").provenance.length, 2);
  assert.equal(result.contacts.find((row) => row.kind === "phone").provenance.length, 2);
  assert.equal(result.counters.evidence_observations, 4);
  assert.equal(result.counters.sources_checked, 5);
  assert.equal(result.counters.email_addresses_found, 1);
});

test("an address existing is not reported as reachable or sendable", () => {
  const result = enrichContactEvidence({
    observed_at: NOW,
    sources: { website: { url: "https://ink.example", email: "hello@ink.example" } }
  });

  assert.equal(result.contacts[0].reachable, null);
  assert.equal(result.contacts[0].sendable, false);
  assert.equal(result.outreach.review_hold, true);
  assert.ok(result.outreach.hold_reasons.includes("email_reachability_unverified"));
  assert.equal(result.outreach.sendable_email, null);
  assert.equal(result.counters.emails_reachability_verified, 0);
});

test("only explicitly verified, sufficiently confident email becomes sendable", () => {
  const result = enrichContactEvidence({
    observed_at: NOW,
    sources: {
      website: {
        url: "https://ink.example/contact",
        email: "owner@ink.example",
        email_reachable: true,
        contact_role: "owner",
        contact_name: "Alex"
      }
    }
  });

  assert.equal(result.contacts[0].sendable, true);
  assert.equal(result.outreach.review_hold, false);
  assert.equal(result.outreach.sendable_email, "owner@ink.example");
  assert.equal(result.recommended_fields.owner_email, "owner@ink.example");
  assert.equal(result.recommended_fields.owner_name, "Alex");
  assert.equal(result.counters.emails_sendable, 1);
});

test("never promotes a generic public inbox into owner identity", () => {
  const result = enrichContactEvidence({
    observed_at: NOW,
    sources: {
      gbp: { email: "info@ink.example", email_status: "deliverable" }
    }
  });

  assert.equal(result.outreach.sendable_email, "info@ink.example");
  assert.equal(result.recommended_fields.owner_email, null);
  assert.equal(result.recommended_fields.owner_name, null);
  assert.equal(result.outreach.review_hold, true);
  assert.ok(result.outreach.hold_reasons.includes("owner_identity_unverified"));
});

test("conflicts, suppression, and low-confidence directory records stay held", () => {
  const result = enrichContactEvidence({
    observed_at: NOW,
    sources: {
      website: { email: "first@ink.example", email_reachable: true, suppressed: true },
      public_directory: { email: "second@ink.example", email_reachable: true }
    }
  });

  assert.equal(result.outreach.review_hold, true);
  assert.ok(result.outreach.hold_reasons.includes("email_conflict_review_required"));
  assert.ok(result.outreach.hold_reasons.includes("email_suppressed"));
  assert.equal(result.contacts.find((row) => row.value === "second@ink.example").sendable, false);
  assert.equal(result.counters.emails_sendable, 0);
});

test("empty sources report confirmed absence with honest zero counters", () => {
  const result = enrichContactEvidence({ observed_at: NOW, sources: {} });
  assert.deepEqual(result.recommended_fields, { email: null, phone: null, owner_email: null, owner_name: null });
  assert.deepEqual(result.outreach.hold_reasons, ["no_contact_evidence"]);
  assert.equal(result.counters.unique_contacts, 0);
  assert.equal(result.counters.emails_sendable, 0);
});

test("normalizes contacts and only permits supported public source classes", () => {
  assert.equal(normalizeEmail(" MAILTO:Hello@Example.com "), "hello@example.com");
  assert.equal(normalizePhone("(555) 123-4567"), "+15551234567");
  assert.equal(normalizeSourceType("GBP"), "google_business_profile");
  assert.equal(normalizeSourceType("linkedin"), null);
});

test("dedupes a public contact while retaining its source provenance", () => {
  const result = enrichPublicContacts(
    { id: "p-1", website: "https://acme.example/about" },
    [
      {
        source_type: "business_website",
        url: "https://acme.example/contact#team",
        emails: ["Sales@Acme.example"],
      },
      {
        source_type: "facebook",
        url: "https://facebook.com/acme",
        contacts: [{ kind: "email", value: "sales@acme.example", locator: "About" }],
      },
    ],
  );

  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].value, "sales@acme.example");
  assert.equal(result.contacts[0].confidence, "high");
  assert.equal(result.contacts[0].raw_found, true);
  assert.equal(result.contacts[0].verified_reachable, false);
  assert.equal(result.contacts[0].sendable, false);
  assert.equal(result.contacts[0].evidence.length, 2);
});

test("does not confuse raw discovery with verified reachability or sendability", () => {
  const result = enrichPublicContacts(
    { website: "https://acme.example" },
    [
      {
        source_type: "business_website",
        url: "https://acme.example/contact",
        contacts: [
          {
            kind: "email",
            value: "hello@acme.example",
            verification: { status: "verified", method: "provider_verification", checked_at: "2026-07-19T12:00:00.000Z" },
          },
        ],
      },
    ],
  );

  assert.equal(result.contacts[0].verified_reachable, true);
  assert.equal(result.contacts[0].confidence, "high");
  assert.equal(result.contacts[0].sendable, true);
  assert.equal(result.contacts[0].disposition, "sendable");
});

test("holds low-confidence directory results and rejects unsupported provenance", () => {
  const result = enrichPublicContacts(
    { website: "https://acme.example" },
    [
      { source_type: "directory", url: "https://directory.example/acme", phone: "555 123 4567" },
      { source_type: "linkedin", url: "https://linkedin.com/company/acme", email: "hello@acme.example" },
      { source_type: "facebook", email: "hello@acme.example" },
    ],
  );

  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].confidence, "low");
  assert.equal(result.contacts[0].disposition, "hold");
  assert.equal(result.summary.held, 1);
  assert.deepEqual(result.rejected_sources.map((item) => item.reason), ["unsupported_source_type", "missing_public_source_url"]);
});

// --- contactSendGate: the send-time verdict wired into lib/email.js -------
//
// This intentionally does NOT hard-block every review_hold:true prospect —
// today's Places-based lead-miner never verifies reachability, so
// review_hold is true for essentially every real mined lead (see
// lib/lead-miner.js rowFromPlace: website email_reachable is always null).
// Only concrete, known-bad hold reasons (suppressed / conflicting / a
// low-confidence source) should stop a send.

test("contactSendGate: a legacy prospect with no contact_enrichment is never gated (pre-feature rows keep working)", () => {
  const gate = contactSendGate({ prospect_id: "legacy-1", email: "owner@legacy.example" });
  assert.equal(gate.hasEnrichment, false);
  assert.equal(gate.blocked, false);
});

test("contactSendGate: a normal mined lead (email found, reachability simply unverified) is NOT blocked", () => {
  // Exactly the shape lib/lead-miner.js rowFromPlace() produces today.
  const contactEnrichment = enrichContactEvidence({
    sources: { website: { url: "https://acme.example", email: "info@acme.example", confidence: 0.8, email_reachable: null } },
  });
  const prospect = {
    prospect_id: "mined-1",
    email: "info@acme.example",
    contact_enrichment: contactEnrichment,
    outreach_review_hold: contactEnrichment.outreach.review_hold,
    outreach_hold_reasons: contactEnrichment.outreach.hold_reasons,
  };
  assert.equal(contactEnrichment.outreach.review_hold, true, "sanity: the raw verdict IS a hold (unverified reachability)");
  const gate = contactSendGate(prospect);
  assert.equal(gate.hasEnrichment, true);
  assert.equal(gate.reviewHold, true);
  assert.equal(gate.blocked, false, "an unverified-but-otherwise-fine address must still be sendable today");
});

test("contactSendGate: blocks a suppressed / conflicting-duplicate address", () => {
  const contactEnrichment = enrichContactEvidence({
    sources: {
      website: { email: "first@ink.example", email_reachable: true, suppressed: true },
      public_directory: { email: "second@ink.example", email_reachable: true },
    },
  });
  const prospect = {
    prospect_id: "conflicted-1",
    email: "first@ink.example",
    record: {
      contact_enrichment: contactEnrichment,
      outreach_review_hold: contactEnrichment.outreach.review_hold,
      outreach_hold_reasons: contactEnrichment.outreach.hold_reasons,
    },
  };
  const gate = contactSendGate(prospect);
  assert.equal(gate.blocked, true);
  assert.ok(gate.blockedReasons.includes("email_suppressed"));
  assert.ok(gate.blockedReasons.includes("email_conflict_review_required"));
});

test("contactSendGate: blocks a low-confidence directory-only source", () => {
  const contactEnrichment = enrichContactEvidence({
    sources: { public_directory: { email: "listing@directory.example", email_reachable: true } },
  });
  const gate = contactSendGate({ prospect_id: "low-conf-1", contact_enrichment: contactEnrichment });
  assert.equal(gate.blocked, true);
  assert.ok(gate.blockedReasons.includes("email_confidence_below_threshold"));
});

test("contactSendGate: does not block on owner-identity-unverified alone (a generic info@ inbox is normal cold-outreach territory)", () => {
  const contactEnrichment = enrichContactEvidence({
    sources: { gbp: { email: "info@ink.example", email_status: "deliverable" } },
  });
  const gate = contactSendGate({ prospect_id: "generic-inbox-1", contact_enrichment: contactEnrichment });
  assert.equal(gate.blocked, false);
  assert.equal(gate.reviewHold, true);
});
