"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { auditServiceLabel } = require("./service-label-audit.cjs");

const BIZ = "https://www.acme-concrete.example/";
const good = (label, extra = {}) => ({
  label,
  businessName: "Acme Concrete, LLC",
  businessUrl: BIZ,
  sourceUrl: `/services/${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  sourceText: `Acme Concrete offers ${label} for homes and businesses.`,
  ...extra,
});

test("known bad labels from failed runs are rejected and the label is preserved", () => {
  const bad = [
    ["The Best Concrete Company in Oklahoma City", "marketing_superlative"],
    ["We're Concrete Kings!", "first_person_promotional"],
    ["for a well-crafted and perfectly appointed wall or curb", "sentence_fragment"],
    ["We love serving our local community with excellent concrete work", "first_person_promotional"],
    ["Tell us about your lawn", "contact_prompt"],
    ["© 2026 Custom Lawn & Landscape, Inc. All rights reserved", "copyright_notice"],
    ["3 Essential Lawn Care Tips", "article_heading"],
    ["How to Prepare Your Lawn for Summer", "article_heading"],
  ];
  for (const [label, reason] of bad) {
    // Even with otherwise perfect evidence, these labels must not pass.
    const r = auditServiceLabel(good(label, { explicitlyOffered: true, sourceText: label }));
    assert.equal(r.status, "rejected", label);
    assert.ok(r.reasons.includes(reason), `${label} -> ${r.reasons}`);
    assert.equal(r.originalLabel, label);
  }
});

test("a label equal to the business name is rejected, including legal-suffix variants", () => {
  for (const label of ["Custom Lawn & Landscape, Inc.", "custom lawn and landscape", "CUSTOM LAWN & LANDSCAPE"]) {
    const r = auditServiceLabel({
      label, businessName: "Custom Lawn & Landscape, Inc.",
      businessUrl: "https://customlawn.example", sourceUrl: "/services/", sourceText: label,
      explicitlyOffered: true,
    });
    assert.equal(r.status, "rejected", label);
    assert.ok(r.reasons.includes("matches_business_name"));
  }
});

test("legitimate noun-phrase services with first-party service evidence are accepted", () => {
  for (const label of ["Drain Cleaning", "Stamped Concrete Patios", "Sod Installation",
    "Retaining Walls", "Concrete Steps", "Phase I Environmental Site Assessment",
    "Call Center Staffing", "Crème Brûlée Catering"]) {
    const r = auditServiceLabel(good(label));
    assert.equal(r.status, "accepted", `${label}: ${r.reasons}`);
    assert.equal(r.originalLabel, label);
  }
});

test("trade words alone never make a label acceptable", () => {
  for (const label of ["Concrete Repair", "Lawn Care", "Roof Repair"]) {
    const r = auditServiceLabel({ label, businessName: "Acme", businessUrl: BIZ });
    assert.equal(r.status, "needs_review", label);
    assert.ok(r.reasons.includes("source_url_missing"));
    assert.ok(r.reasons.includes("source_text_missing"));
  }
});

test("generic labels are not rejected but need explicit offering evidence", () => {
  for (const label of ["Outdoor Services", "Decorative Services"]) {
    const noFlag = auditServiceLabel(good(label, { sourceUrl: "/", explicitlyOffered: false }));
    assert.equal(noFlag.status, "needs_review", label);
    assert.ok(noFlag.reasons.includes("generic_label_requires_explicit_offering"));
    // A /services/ path is not enough for a generic label.
    const pathOnly = auditServiceLabel(good(label));
    assert.equal(pathOnly.status, "needs_review");
    const offered = auditServiceLabel(good(label, { explicitlyOffered: true }));
    assert.equal(offered.status, "accepted", `${label}: ${offered.reasons}`);
  }
});

test("a blog slug that matches the label does not establish a service", () => {
  const r = auditServiceLabel(good("Drain Cleaning", {
    sourceUrl: "https://acme-concrete.example/blog/drain-cleaning",
    sourceText: "Drain Cleaning: what homeowners should know.",
  }));
  assert.equal(r.status, "needs_review");
  assert.ok(r.reasons.includes("editorial_source_path"));
  assert.ok(r.reasons.includes("slug_match_is_not_offering_evidence"));
  const offered = auditServiceLabel(good("Drain Cleaning", {
    sourceUrl: "/blog/drain-cleaning/", explicitlyOffered: true,
  }));
  assert.equal(offered.status, "needs_review", "editorial pages stay advisory even when flagged");
});

test("service URL with explicit source text supports the label; URL variants are handled", () => {
  const variants = [
    "/services/drain-cleaning",
    "/services/drain-cleaning/",
    "/Services/Drain-Cleaning#top",
    "https://ACME-CONCRETE.example/services/drain-cleaning?utm=x",
    "services/drain-cleaning",
  ];
  for (const sourceUrl of variants) {
    const r = auditServiceLabel(good("Drain Cleaning", { sourceUrl }));
    assert.equal(r.status, "accepted", `${sourceUrl}: ${r.reasons}`);
  }
  const noText = auditServiceLabel(good("Drain Cleaning", { sourceText: "Call today for a quote." }));
  assert.equal(noText.status, "needs_review");
  assert.ok(noText.reasons.includes("label_not_in_source_text"));
});

test("a word inside a longer word is not a source-text mention", () => {
  const r = auditServiceLabel(good("Paving", { sourceText: "We handle repavings only." }));
  assert.equal(r.status, "needs_review");
  assert.ok(r.reasons.includes("label_not_in_source_text"));
});

test("relative tenant paths resolve under the tenant and must stay inside it", () => {
  const tenant = { businessUrl: "https://sites.example/t/acme", businessName: "Acme" };
  const inside = auditServiceLabel({ ...tenant, label: "Gutter Cleaning",
    sourceUrl: "services/gutter-cleaning", sourceText: "Gutter cleaning is offered." });
  assert.equal(inside.status, "accepted", String(inside.reasons));
  const outside = auditServiceLabel({ ...tenant, label: "Gutter Cleaning",
    sourceUrl: "/t/other-tenant/services/gutter-cleaning", sourceText: "Gutter cleaning is offered." });
  assert.equal(outside.status, "needs_review");
  assert.ok(outside.reasons.includes("source_outside_business_tenant_path"));
});

test("other hosts and sibling subdomains never establish first-party evidence", () => {
  const cases = [
    ["https://yelp.example/services/drain-cleaning", "source_host_different_host"],
    ["https://blog.acme-concrete.example/services/drain-cleaning", "source_host_related_subdomain"],
    ["https://acme-concrete.example.evil.example/services/drain-cleaning", "source_host_different_host"],
    ["https://acme-concrete.example:8443/services/drain-cleaning", "source_host_different_host"],
  ];
  for (const [sourceUrl, reason] of cases) {
    const r = auditServiceLabel(good("Drain Cleaning", { sourceUrl, explicitlyOffered: true }));
    assert.equal(r.status, "needs_review", sourceUrl);
    assert.ok(r.reasons.some((x) => x.startsWith("source_host_")), `${sourceUrl}: ${r.reasons}`);
    assert.ok(r.reasons.includes(reason) || reason === "source_host_different_host", `${sourceUrl}: ${r.reasons}`);
  }
  const sibling = auditServiceLabel({ label: "Drain Cleaning", businessName: "Acme",
    businessUrl: "https://shop.acme.example", sourceUrl: "https://blog.acme.example/services/drain-cleaning",
    sourceText: "Drain Cleaning", explicitlyOffered: true });
  assert.ok(sibling.reasons.includes("source_host_sibling_subdomain"));
});

test("missing or malformed evidence is needs_review, never accepted", () => {
  const cases = [
    { label: "Drain Cleaning" },
    { label: "Drain Cleaning", sourceUrl: "/services/drain-cleaning", sourceText: "Drain Cleaning" },
    { label: "Drain Cleaning", businessUrl: "not a url at all", sourceUrl: "/services/x", sourceText: "Drain Cleaning" },
    { label: "Drain Cleaning", businessUrl: BIZ, sourceUrl: "javascript:alert(1)", sourceText: "Drain Cleaning" },
    { label: "Drain Cleaning", businessUrl: BIZ, sourceUrl: "/services/drain-cleaning", sourceText: "   " },
    { label: "Drain Cleaning", businessUrl: BIZ, sourceUrl: "/about", sourceText: "Drain Cleaning" },
  ];
  for (const c of cases) assert.equal(auditServiceLabel(c).status, "needs_review", JSON.stringify(c));
  assert.equal(auditServiceLabel({ label: "" }).status, "rejected");
  assert.equal(auditServiceLabel({ label: 42 }).originalLabel, 42);
  assert.equal(auditServiceLabel().status, "rejected");
});

test("explicitlyOffered must be strictly true", () => {
  const r = auditServiceLabel(good("Drain Cleaning", { sourceUrl: "/", explicitlyOffered: "yes" }));
  assert.equal(r.status, "needs_review");
});

test("Unicode normalization is used for analysis only", () => {
  const label = "Ｄrain  Cleaning"; // fullwidth D, double space
  const r = auditServiceLabel(good("Drain Cleaning", { label }));
  assert.equal(r.status, "accepted", String(r.reasons));
  assert.equal(r.originalLabel, label);
  const curly = auditServiceLabel(good("x", { label: "We\u2019re Concrete Kings" }));
  assert.equal(curly.status, "rejected");
});

test("input object is not mutated", () => {
  const input = Object.freeze(good("Drain Cleaning"));
  const copy = JSON.stringify(input);
  auditServiceLabel(input);
  assert.equal(JSON.stringify(input), copy);
});
