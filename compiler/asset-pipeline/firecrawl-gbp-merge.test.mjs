import test from "node:test";
import assert from "node:assert/strict";
import { mergeEnrichment } from "./firecrawl-gbp-merge.mjs";

const markdown = [
  "Monday 8 AM-5 PM",
  "Tuesday 8 AM-5 PM",
  "Wednesday 8 AM-5 PM",
  "Thursday 8 AM-5 PM",
  "Friday 8 AM-5 PM",
  "Saturday Closed",
  "Sunday Closed",
  "123 Main St, Mesa, AZ 85201",
  "555-222-3333",
  "Service areas: Mesa, Tempe",
  "Alice Smith",
  "a week ago",
  "5 stars",
  "The team was clear, responsive, and professional from the first call through the finished work.",
].join("\n");

test("verified structured facts win over weaker parsed GBP markdown", () => {
  const packet = {
    business: { name: "Trusted Co", city: "Mesa", state: "AZ" },
    enrichment_sources: {
      hours: {
        source: "structured-jsonld",
        confidence: 0.99,
        provenance: "owner-approved",
        value: ["Monday: 7 AM-4 PM"],
        hours_spec: [{ "@type": "OpeningHoursSpecification", dayOfWeek: "Monday", opens: "07:00", closes: "16:00" }],
      },
      reviews_attributed: {
        source: "approved-review-import",
        confidence: 0.98,
        provenance: "operator-approved",
        value: [{ author: "Verified Customer", rating: 5, text: "The verified review stays authoritative.", source: "site" }],
      },
      photos: {
        source: "owner-upload",
        confidence: 1,
        provenance: "upload-42",
        value: ["https://owner.example/work.jpg?width=1200"],
      },
      nap: {
        source: "structured-nap",
        confidence: 0.99,
        provenance: "owner-approved",
        value: { name: "Trusted Co", address: "9 Verified Ave, Mesa, AZ 85201", phone: "555-111-1111" },
      },
      service_areas: {
        source: "structured-service-area",
        confidence: 0.97,
        provenance: "owner-approved",
        value: ["Mesa", "Tempe"],
      },
      gbp_raw: {
        source: "firecrawl",
        confidence: 0.7,
        value: { markdown, links: [{ url: "https://lh5.googleusercontent.com/p/AF1QipNEW=w1200" }] },
      },
    },
    media: { catalog: [{ kind: "photo", url: "https://owner.example/work.jpg?width=1200", source: "upload", proof_eligible: true }] },
  };

  mergeEnrichment(packet);
  const src = packet.enrichment_sources;

  assert.equal(src.hours.source, "structured-jsonld");
  assert.equal(src.hours.confidence, 0.99);
  assert.equal(src.hours.provenance, "owner-approved");
  assert.deepEqual(src.hours.value.find((item) => item.day === "Monday"), { day: "Monday", hours: "7 AM-4 PM" });
  assert.deepEqual(src.hours.hours_spec, [{ "@type": "OpeningHoursSpecification", dayOfWeek: "Monday", opens: "07:00", closes: "16:00" }]);

  assert.equal(src.reviews_attributed.source, "approved-review-import");
  assert.equal(src.reviews_attributed.provenance, "operator-approved");
  assert.equal(src.reviews_attributed.value[0].author, "Verified Customer");

  assert.equal(src.photos.source, "owner-upload");
  assert.equal(src.photos.provenance, "upload-42");
  assert.ok(src.photos.value.includes("https://owner.example/work.jpg?width=1200"));
  assert.equal(src.nap.value.address, "9 Verified Ave, Mesa, AZ 85201");
  assert.equal(src.nap.value.phone, "555-111-1111");
  assert.deepEqual(src.service_areas.value.slice(0, 2), ["Mesa", "Tempe"]);
  assert.ok(packet.media.catalog.some((item) => item.url.includes("owner.example/work.jpg")));
});

test("empty or malformed markdown never erases existing structured facts", () => {
  const packet = {
    business: { name: "Stable Co", city: "Mesa" },
    enrichment_sources: {
      hours: { source: "structured", confidence: 1, value: [{ day: "Monday", hours: "7 AM-4 PM" }] },
      reviews_attributed: { source: "structured", confidence: 1, value: [{ author: "Customer", rating: 5, text: "An approved review.", source: "site" }] },
      photos: { source: "structured", confidence: 1, value: ["https://owner.example/approved.jpg"] },
      nap: { source: "structured", confidence: 1, value: { name: "Stable Co", address: "1 Approved Ave", phone: "555-000-0000" } },
      service_areas: { source: "structured", confidence: 1, value: ["Mesa"] },
      gbp_raw: { value: { markdown: { malformed: true }, links: { malformed: true } } },
    },
    media: { catalog: [{ kind: "photo", url: "https://owner.example/approved.jpg", source: "upload" }] },
  };

  assert.doesNotThrow(() => mergeEnrichment(packet));
  const src = packet.enrichment_sources;
  assert.deepEqual(src.hours.value, [{ day: "Monday", hours: "7 AM-4 PM" }]);
  assert.deepEqual(src.reviews_attributed.value, [{ author: "Customer", rating: 5, text: "An approved review.", source: "site" }]);
  assert.deepEqual(src.photos.value, ["https://owner.example/approved.jpg"]);
  assert.deepEqual(src.nap.value, { name: "Stable Co", address: "1 Approved Ave", phone: "555-000-0000" });
  assert.deepEqual(src.service_areas.value, ["Mesa"]);
  assert.equal(src.hours.source, "structured");
  assert.equal(src.photos.source, "structured");
});

test("parsed GBP output is normalized for 05-build-v8", () => {
  const packet = {
    business: { name: "Mesa Works", city: "Mesa", state: "AZ" },
    enrichment_sources: {
      gbp_raw: {
        source: "firecrawl",
        confidence: 0.7,
        value: { markdown, links: [{ url: "https://lh5.googleusercontent.com/p/AF1QipPHOTO=w1200" }] },
      },
    },
  };

  mergeEnrichment(packet);
  const src = packet.enrichment_sources;

  assert.equal(src.hours.source, "gbp-markdown");
  assert.equal(src.hours.confidence, 0.85);
  assert.ok(Array.isArray(src.hours.value));
  assert.deepEqual(src.hours.value.map((item) => item.day), ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
  assert.ok(src.hours.value.every((item) => item.day && item.hours));
  assert.ok(Array.isArray(src.hours.hours_spec));

  assert.ok(Array.isArray(src.reviews_attributed.value));
  assert.equal(src.reviews_attributed.value[0].author, "Alice Smith");
  assert.equal(src.reviews_attributed.value[0].source, "gbp");
  assert.match(src.reviews_attributed.value[0].text, /clear, responsive/);

  assert.deepEqual(src.nap.value, { name: "Mesa Works", address: "123 Main St, Mesa, AZ 85201", phone: "555-222-3333" });
  assert.deepEqual(src.service_areas.value, ["Mesa", "Tempe"]);
  assert.ok(packet.media.catalog.some((item) => item.url.includes("AF1QipPHOTO") && item.source === "gbp" && item.provenance === "firecrawl-gbp-markdown"));
});

test("verified city and state become the only service-area fallback", () => {
  const packet = {
    business: { name: "City Only Co", city: "Mesa", state: "AZ" },
    enrichment_sources: {},
  };

  mergeEnrichment(packet);

  assert.deepEqual(packet.enrichment_sources.service_areas, {
    source: "verified-business-location",
    confidence: 0.7,
    provenance: "business.city+business.state",
    derived: true,
    scope: "verified-city-only",
    value: ["Mesa, AZ"],
    fallback: "verified city only; no separate service-area evidence",
  });
});

test("verified city fallback replaces an empty unsourced service-area placeholder", () => {
  const packet = {
    business: { name: "Placeholder Co", city: "Fresno", state: "CA" },
    enrichment_sources: {
      service_areas: { source: "manual", confidence: 0, value: null },
    },
  };

  mergeEnrichment(packet);

  const fact = packet.enrichment_sources.service_areas;
  assert.deepEqual(fact.value, ["Fresno, CA"]);
  assert.equal(fact.source, "verified-business-location");
  assert.equal(fact.scope, "verified-city-only");
  assert.equal(fact.derived, true);
  assert.match(fact.fallback, /no separate service-area evidence/);
});

test("service-area fallback is not inferred without both verified city and state", () => {
  const packet = {
    business: { name: "Incomplete Location Co", city: "Mesa" },
    enrichment_sources: {},
  };

  mergeEnrichment(packet);

  assert.deepEqual(packet.enrichment_sources.service_areas, {
    source: "manual",
    confidence: 0,
    value: null,
    fallback: "single-city footer, no county coverage claim",
  });
});
