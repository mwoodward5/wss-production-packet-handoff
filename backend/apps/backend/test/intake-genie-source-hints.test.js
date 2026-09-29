"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const { prospectRequest } = require("../lib/intake-genie-client");
const { compileGenieContent } = require("../lib/line-adapters");
const { leadToProspect, validateLeadBatch } = require("../lib/leadminer-webhook");

function proof(source, sourceKind = "site_scrape") {
  return {
    source,
    source_kind: sourceKind,
    captured_at: "2026-08-25T20:00:00.000Z",
  };
}

function certifiedPracticeContract(category = "plumbing") {
  const files = {
    "content/home.md": "# Affordable Plumbing Company\n\nAffordable Plumbing Company offers drain cleaning for customers in Jacksonville.",
  };
  return {
    schema: "CertifiedPracticePacket/v1",
    kind: "certified_practice_packet",
    version: 1,
    facts: { category },
    assets: {},
    builder_instructions: { public: false },
    visitor_copy: {
      kind: "visitor_copy",
      files,
      file_hashes: Object.fromEntries(Object.entries(files).map(([file, body]) => [
        file,
        createHash("sha256").update(body).digest("hex"),
      ])),
      safety: { pass: true, violations: [] },
    },
  };
}

function completeStyleProspect(overrides = {}) {
  const website = "http://completehomesolutionsar.com/";
  const about = "https://completehomesolutionsar.com/about-us/";
  const services = "https://completehomesolutionsar.com/plumbing/";
  return {
    prospect_id: "complete-source-hints",
    business_name: "Complete Plumbing, Electric & Air",
    city: "Sherwood",
    state: "AR",
    industry: "plumbing",
    website,
    status: "held",
    updated_at: "2026-08-25T20:00:00.000Z",
    record: {
      status: "held",
      truth_packet_source: "leadminer_mirror_ready",
      truth_packet: {
        source: "leadminer_mirror_ready",
        identity: {
          name: {
            value: "Complete Plumbing and Electric Solutions LLC",
            verified: true,
            status: "verified",
            source: about,
          },
          category: {
            value: "plumbing",
            verified: true,
            status: "verified",
            source: services,
          },
        },
        mirror_ready: {
          business_name: "Complete Plumbing and Electric Solutions LLC",
          industry: "plumbing",
          services: [
            { name: "Drain Cleaning" },
            { name: "Water Heater Repair" },
            { name: "Foreign Injected Service" },
            { name: "Generated Guess", generated: true },
          ],
          provenance: {
            "/business_name": proof(about),
            "/industry": proof(services),
            "/services/0/name": proof(services),
            "/services/1/name": proof("https://completehomesolutionsar.com/contact-us/"),
            "/services/2/name": proof("https://foreign.example/services"),
            "/services/3/name": proof(services),
          },
        },
        service_evidence: [
          {
            field: "services",
            value: "Emergency Plumbing",
            source: services,
            source_url: services,
            verified: true,
            status: "verified",
          },
          {
            field: "services",
            value: "Unverified Service",
            source_url: services,
            verified: false,
            status: "observed",
          },
          {
            field: "services",
            value: "Generated Evidence",
            source_url: services,
            verified: true,
            status: "verified",
            generated: true,
          },
          {
            field: "services",
            value: "Foreign Evidence",
            source_url: "https://foreign.example/services",
            verified: true,
            status: "verified",
          },
        ],
      },
    },
    ...overrides,
  };
}

test("source-bound durable truth enriches Intake while preserving first-party subpage sources", () => {
  const prospect = completeStyleProspect();
  const before = structuredClone(prospect);

  const request = prospectRequest(prospect, { pipelineVersion: "line-genie-certified-v4" });

  assert.deepEqual(request.corrections, {
    name: "Complete Plumbing and Electric Solutions LLC",
    category: "plumbing",
    services: ["Drain Cleaning", "Water Heater Repair"],
  });
  assert.deepEqual(request.conflict_resolution, request.corrections);
  assert.equal(request.prospect_hints.name, request.corrections.name);
  assert.equal(request.prospect_hints.category, request.corrections.category);
  assert.deepEqual(request.prospect_hints.services, request.corrections.services);
  assert.deepEqual(request.sources.additional_urls, [
    "https://completehomesolutionsar.com/about-us/",
    "https://completehomesolutionsar.com/plumbing/",
    "https://completehomesolutionsar.com/contact-us/",
  ]);
  assert.equal((request.sources.additional_urls || []).some((url) => url.includes("foreign.example")), false);
  assert.equal((request.sources.additional_urls || []).some((url) => url.includes("google.com")), false);
  assert.equal(request.request_id, "ghost:complete-source-hints:line-genie-certified-v4");
  assert.deepEqual(prospect, before, "request enrichment must not mutate the stored authority packet");
});

test("live-shaped Firecrawl markdown becomes clean first-party service hints", () => {
  const website = "http://www.affordableplumbingjacksonville.com/";
  const row = {
    prospect_id: "affordable-live-shaped-services",
    business_name: "Affordable Plumbing",
    city: "Jacksonville",
    state: "FL",
    industry: "plumbing",
    website,
    record: {
      truth_packet_source: "leadminer_mirror_ready",
      truth_packet: {
        mirror_ready: {
          business_name: "Affordable Plumbing",
          services: [
            { name: "- [Emergency Plumbing](https://www.affordableplumbingjacksonville.com/)" },
            { name: "- [Contact Us](https://www.affordableplumbingjacksonville.com/contact/)" },
            { name: "- [Foreign Service](https://foreign.example/services)" },
          ],
          provenance: {
            "/business_name": proof(website, "website"),
            "/services/0/name": proof(website, "website"),
            "/services/1/name": proof(website, "website"),
            "/services/2/name": proof(website, "website"),
          },
        },
      },
    },
  };

  const request = prospectRequest(row, { pipelineVersion: "line-genie-certified-v5" });

  assert.deepEqual(request.corrections.services, ["Emergency Plumbing"]);
  assert.deepEqual(request.prospect_hints.services, ["Emergency Plumbing"]);
  assert.equal(JSON.stringify(request).includes("Contact Us"), false);
  assert.equal(JSON.stringify(request).includes("Foreign Service"), false);
});

test("explicit owner corrections win and unbound packet claims are never promoted", () => {
  const prospect = completeStyleProspect({
    record: {
      owner_corrections: {
        name: "Complete Plumbing and Electric Solutions LLC",
        category: "general contractor",
        services: ["Owner-confirmed Restoration"],
      },
      truth_packet: {
        mirror_ready: {
          business_name: "Foreign Replacement Co",
          industry: "hvac",
          services: ["Invented Service"],
          provenance: {
            "/business_name": proof("https://foreign.example/about"),
            "/industry": proof("https://foreign.example/services"),
            "/services/0/name": proof("https://foreign.example/services"),
          },
        },
        services: ["Loose Packet Guess"],
        service_evidence: [
          {
            field: "services",
            value: "Generated Same-owner Guess",
            source_url: "https://completehomesolutionsar.com/services/",
            verified: true,
            status: "verified",
            generated: true,
          },
        ],
      },
    },
  });

  const request = prospectRequest(prospect);

  assert.deepEqual(request.corrections, {
    name: "Complete Plumbing and Electric Solutions LLC",
    category: "general contractor",
    services: ["Owner-confirmed Restoration"],
  });
  assert.deepEqual(request.prospect_hints.services, ["Owner-confirmed Restoration"]);
  assert.equal(request.prospect_hints.category, "general contractor");
  assert.equal((request.sources.additional_urls || []).some((url) => url.includes("foreign.example")), false);
  assert.equal(JSON.stringify(request).includes("Invented Service"), false);
  assert.equal(JSON.stringify(request).includes("Loose Packet Guess"), false);
  assert.equal(JSON.stringify(request).includes("Generated Same-owner Guess"), false);
});

test("source enrichment does not widen a deterministic compiler refusal beyond its candidate", async () => {
  let request;
  const result = await compileGenieContent(completeStyleProspect(), {
    certificationKey: "source-hints-test-certification-key",
    env: { GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION: "1" },
    callIntakeGenie: async (prospect, options) => {
      request = prospectRequest(prospect, options);
      return { ok: false, status: 422, error: "candidate_source_unreadable" };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.equal(result.candidateLocal, true);
  assert.equal(result.reason, "candidate_source_unreadable");
  assert.deepEqual(request.corrections.services, [
    "Drain Cleaning",
    "Water Heater Repair",
  ]);
});

test("Affordable's source-proven Company suffix promotes and certifies for the shorter row name", async () => {
  const website = "https://affordableplumbingjacksonville.com/";
  const about = `${website}about/`;
  const services = `${website}services/`;
  const row = {
    prospect_id: "affordable-source-hints",
    business_name: "Affordable Plumbing",
    city: "Jacksonville",
    state: "FL",
    industry: "plumbing",
    website,
    status: "held",
    updated_at: "2026-08-25T20:00:00.000Z",
    record: {
      status: "held",
      truth_packet_source: "leadminer_mirror_ready",
      truth_packet: {
        source: "leadminer_mirror_ready",
        service_evidence: [{
          field: "services",
          value: "Teleportation Roofing",
          source_url: `${website}fake-service`,
          verified: true,
          status: "verified",
        }],
        mirror_ready: {
          business_name: "Affordable Plumbing Company",
          industry: "plumbing",
          services: [{ name: "Drain Cleaning" }],
          provenance: {
            "/business_name": proof(about),
            "/industry": proof(services),
            "/services/0/name": proof(services),
          },
        },
      },
    },
  };
  let persisted;

  const compiled = await compileGenieContent(row, {
    certificationKey: "source-hints-test-certification-key",
    env: { GHOST_AGENCY_REQUIRE_GENIE_CERTIFIED_ADMISSION: "1" },
    now: () => "2026-08-25T20:01:00.000Z",
    callIntakeGenie: async (prospect, options) => {
      const request = prospectRequest(prospect, options);
      assert.equal(request.corrections.name, "Affordable Plumbing Company");
      assert.equal(request.prospect_hints.name, "Affordable Plumbing Company");
      return {
        ok: true,
        request,
        idempotencyKey: request.request_id,
        packet: {
          ok: true,
          version: "intake-genie-v2",
          status: "complete",
          scope: { supported: true, category: "plumbing" },
          job_id: "genie-affordable-source-hints",
          request_id: request.request_id,
          facts: {
            name: "Affordable Plumbing Company",
            city: "Jacksonville",
            state: "FL",
            category: "plumbing",
            services: ["Drain Cleaning", "Teleportation Roofing"],
          },
          content: { content_contract: certifiedPracticeContract() },
          evidence: [
            { field: "name", value: "Affordable Plumbing Company", source_url: about },
            {
              field: "services",
              value: "Teleportation Roofing",
              source_url: `${website}fake-service`,
              verified: true,
              status: "verified",
            },
          ],
        },
      };
    },
    conditionalUpdate: async (_table, _key, _id, _guards, patch) => {
      persisted = patch.record;
      return { ok: true, updated: true };
    },
  });

  assert.equal(compiled.ok, true, JSON.stringify(compiled));
  assert.equal(compiled.certified, true);
  assert.equal(persisted.genie_content_certification.status, "certified");
  assert.equal(persisted.genie_canonical_packet.facts.name, "Affordable Plumbing Company");
  assert.deepEqual(persisted.genie_canonical_packet.facts.services, ["Drain Cleaning"]);
  assert.equal(JSON.stringify(persisted.genie_canonical_packet).includes("Teleportation Roofing"), false);
});

test("shared-host evidence from another tenant cannot promote services or crawl sources", () => {
  const cases = [
    {
      label: "Wix path tenant",
      website: "https://mark.wixsite.com/affordable/",
      ownAbout: "https://mark.wixsite.com/affordable/about",
      otherServices: "https://mark.wixsite.com/other-plumber/services",
    },
    {
      label: "WordPress subdomain tenant",
      website: "https://affordable.wordpress.com/",
      ownAbout: "https://affordable.wordpress.com/about",
      otherServices: "https://other-plumber.wordpress.com/services",
    },
  ];

  for (const row of cases) {
    const prospect = {
      prospect_id: `shared-host-${row.label}`,
      business_name: "Affordable Plumbing",
      industry: "plumbing",
      website: row.website,
      record: {
        truth_packet_source: "leadminer_mirror_ready",
        truth_packet: {
          source: "leadminer_mirror_ready",
          mirror_ready: {
            business_name: "Affordable Plumbing",
            industry: "plumbing",
            services: [{ name: "Tenant Theft Service" }],
            provenance: {
              "/business_name": proof(row.ownAbout),
              "/industry": proof(row.ownAbout),
              "/services/0/name": proof(row.otherServices),
            },
          },
        },
      },
    };

    const request = prospectRequest(prospect);
    assert.equal(Object.hasOwn(request.corrections, "services"), false, row.label);
    assert.equal(Object.hasOwn(request.prospect_hints, "services"), false, row.label);
    assert.equal((request.sources.additional_urls || []).includes(row.otherServices), false, row.label);
    assert.equal(JSON.stringify(request).includes("Tenant Theft Service"), false, row.label);
  }
});

test("a foreign category proof cannot override the row's original category hint", () => {
  const prospect = completeStyleProspect();
  prospect.record.truth_packet.mirror_ready.industry = "hvac";
  prospect.record.truth_packet.mirror_ready.services = [];
  prospect.record.truth_packet.service_evidence = [];
  prospect.record.truth_packet.mirror_ready.provenance["/industry"] = proof("https://foreign.example/category");

  const request = prospectRequest(prospect);

  assert.equal(Object.hasOwn(request.corrections, "category"), false);
  assert.equal(request.prospect_hints.category, "plumbing");
  assert.equal((request.sources.additional_urls || []).some((url) => url.includes("foreign.example")), false);
});

test("a packet self-label cannot substitute for the durable record source declaration", () => {
  const prospect = completeStyleProspect();
  delete prospect.record.truth_packet_source;

  const request = prospectRequest(prospect);

  assert.deepEqual(request.corrections, {});
  assert.equal(Object.hasOwn(request.prospect_hints, "name"), false);
  assert.equal(request.prospect_hints.city, prospect.city);
  assert.equal(request.prospect_hints.state, prospect.state);
  assert.equal(request.prospect_hints.category, prospect.industry);
  assert.equal(Object.hasOwn(request.prospect_hints, "services"), false);
  assert.deepEqual(request.sources.additional_urls || [], []);
});

test("owner correction aliases override durable truth under canonical Intake keys", () => {
  const prospect = completeStyleProspect();
  prospect.record.owner_corrections = {
    business_name: "Owner Confirmed Home Services",
    industry: "general contractor",
    services: ["Owner Confirmed Restoration"],
  };

  const request = prospectRequest(prospect);

  assert.deepEqual(request.corrections, {
    name: "Owner Confirmed Home Services",
    category: "general contractor",
    services: ["Owner Confirmed Restoration"],
  });
  assert.equal(request.prospect_hints.name, "Owner Confirmed Home Services");
  assert.equal(request.prospect_hints.category, "general contractor");
  assert.deepEqual(request.prospect_hints.services, ["Owner Confirmed Restoration"]);
  assert.equal(Object.hasOwn(request.corrections, "business_name"), false);
  assert.equal(Object.hasOwn(request.corrections, "industry"), false);

  prospect.record.owner_corrections.services = [];
  const explicitlyEmpty = prospectRequest(prospect);
  assert.deepEqual(explicitlyEmpty.corrections.services, []);
  assert.equal(Object.hasOwn(explicitlyEmpty.prospect_hints, "services"), false);
});

test("canonical Google Places and exact LeadMiner enrichment provenance promote; mismatched IDs do not", () => {
  const canonicalPlaceId = "ChIJCanonical123";
  const base = {
    prospect_id: "canonical-provider-provenance",
    canonical_place_id: canonicalPlaceId,
    business_name: "Canonical Plumbing",
    industry: "plumbing",
    website: "https://canonical-plumbing.example/",
    record: {
      truth_packet_source: "leadminer_mirror_ready",
      truth_packet: {
        source: "leadminer_mirror_ready",
        mirror_ready: {
          business_name: "Canonical Plumbing",
          industry: "plumbing",
          services: [{ name: "Drain Cleaning" }],
          provenance: {
            "/business_name": proof(
              `https://places.googleapis.com/v1/places/${encodeURIComponent(canonicalPlaceId)}`,
              "google_places_api",
            ),
            "/industry": proof(
              `leadminer:enrichment:${canonicalPlaceId}`,
              "leadminer_derived",
            ),
            "/services/0/name": proof("https://canonical-plumbing.example/services"),
          },
        },
      },
    },
  };

  const accepted = prospectRequest(base);
  assert.deepEqual(accepted.corrections, {
    name: "Canonical Plumbing",
    category: "plumbing",
    services: ["Drain Cleaning"],
  });

  const mismatched = structuredClone(base);
  mismatched.record.truth_packet.mirror_ready.provenance["/business_name"] = proof(
    "https://places.googleapis.com/v1/places/ChIJDifferent",
    "google_places_api",
  );
  mismatched.record.truth_packet.mirror_ready.provenance["/industry"] = proof(
    "leadminer:enrichment:ChIJDifferent",
    "leadminer_derived",
  );
  const refused = prospectRequest(mismatched);
  assert.deepEqual(refused.corrections, {});
  assert.equal(Object.hasOwn(refused.prospect_hints, "services"), false);
});

test("canonical LeadMiner project-trade provenance promotes only its matching verified category", () => {
  const canonicalPlaceId = "ChIJProjectTrade123";
  const places = `https://places.googleapis.com/v1/places/${canonicalPlaceId}`;
  const website = "https://project-trade-plumbing.example/";
  const [lead] = validateLeadBatch([{
    business_name: "Project Trade Plumbing",
    place_id: canonicalPlaceId,
    industry: "plumber",
    website_url: website,
    city: "Fresno",
    state: "CA",
    services: [{ name: "Drain Cleaning" }],
    provenance: {
      "/business_name": proof(places, "google_places_api"),
      "/place_id": proof(places, "google_places_api"),
      "/industry": proof("leadminer:project-trade:plumber", "leadminer_derived"),
      "/website_url": proof(places, "google_places_api"),
      "/city": proof(places, "google_places_api"),
      "/state": proof(places, "google_places_api"),
      "/services/0/name": proof(`${website}services/`),
    },
  }]);
  const prospect = leadToProspect(lead, { capturedAt: "2026-08-25T20:01:00.000Z" });

  const accepted = prospectRequest(prospect);
  assert.equal(prospect.record.truth_packet_source, "leadminer_mirror_ready");
  assert.equal(prospect.canonical_place_id, canonicalPlaceId);
  assert.deepEqual(accepted.corrections, {
    name: "Project Trade Plumbing",
    category: "plumber",
    services: ["Drain Cleaning"],
  });

  const mismatched = structuredClone(prospect);
  mismatched.record.truth_packet.mirror_ready.provenance["/industry"].source = "leadminer:project-trade:hvac";
  const refused = prospectRequest(mismatched);
  assert.equal(Object.hasOwn(refused.corrections, "category"), false);
  assert.equal(refused.prospect_hints.category, "plumbing");
  assert.deepEqual(refused.corrections.services, ["Drain Cleaning"]);
});
