import assert from "node:assert/strict";
import test from "node:test";
import { deriveFacts } from "../lib/intake-genie-core.mjs";
import {
  factsFromDiscovery,
  resolveBusinessIdentity,
  sameBusinessIdentity,
} from "../lib/intake-genie.mjs";
import { cleanServicesWithProvenance } from "../lib/business-truth.mjs";

// Owner directive 2026-09-19:
//   (3) the freeform name parser must prefer corroborated source identity
//       over weak prompt inference and reject genuine conflicts;
//   (4) final service selection must preserve real source-supported services
//       (10 discovered -> 4 broad labels was the deletion defect).

const WEBSITE = "https://austinroofer.net/";

function freeformInput(description) {
  return { description, sources: { website_url: WEBSITE }, prospect_hints: {} };
}

test("a 'create a preview for <url>' prompt infers NO business name", () => {
  const { facts } = deriveFacts(freeformInput("Create a private preview for https://austinroofer.net/ roofing"));
  // The imperative request phrase and the URL are not an identity. With no
  // other signal the domain name is the honest fallback — never the request
  // prose itself.
  assert.ok(!/preview/i.test(facts.name || ""));
  assert.ok(!/create/i.test(facts.name || ""));
  assert.ok(!/https?:/i.test(facts.name || ""));
  assert.ok(!/for /i.test(facts.name || ""));
});

test("an explicit 'my business is called' statement still wins as a hint-level name", () => {
  const { facts } = deriveFacts(freeformInput(
    "My business is called Austin Roofing Company. We provide roofing services in Austin, TX. Website: https://austinroofer.net/.",
  ));
  assert.equal(facts.name, "Austin Roofing Company");
  assert.equal(facts.name_source, "inferred"); // no prospect_hints.name — prose-level explicit statement
});

test("sameBusinessIdentity: legal suffixes and punctuation carry no identity", () => {
  assert.equal(sameBusinessIdentity("Austin Roofing Company", "Austin Roofing Company, LLC"), true);
  assert.equal(sameBusinessIdentity("Austin Roofing Company", "austin roofing company"), true);
  assert.equal(sameBusinessIdentity("Austin Roofing Company", "Bob's Plumbing Service"), false);
  assert.equal(sameBusinessIdentity("865 Titan Concrete", "Titan Concrete Construction"), true);
});

test("resolveBusinessIdentity: weak inference loses to the website's own identity", () => {
  const verdict = resolveBusinessIdentity({
    promptName: "A Private Preview For",
    promptSource: "inferred",
    siteName: "Austin Roofing Company",
    fallbackName: "",
    city: "Austin",
  });
  assert.equal(verdict.name, "Austin Roofing Company");
  assert.ok(verdict.overridden);
  assert.equal(verdict.overridden.reason, "weak_prompt_inference_replaced_by_source_identity");
  assert.ok(!verdict.conflict);
});

test("resolveBusinessIdentity: corroborated names keep the source spelling", () => {
  const verdict = resolveBusinessIdentity({
    promptName: "austin roofing company",
    promptSource: "inferred",
    siteName: "Austin Roofing Company, LLC",
    fallbackName: "",
    city: "Austin",
  });
  assert.equal(verdict.name, "Austin Roofing Company LLC"); // source spelling, commas normalized
  assert.ok(verdict.corroborated);
  assert.ok(!verdict.conflict);
});

test("resolveBusinessIdentity: an explicit operator hint contradicting the site is a genuine conflict", () => {
  const verdict = resolveBusinessIdentity({
    promptName: "Bob's Plumbing Service",
    promptSource: "hint",
    siteName: "Austin Roofing Company",
    fallbackName: "",
    city: "Austin",
  });
  assert.ok(verdict.conflict);
  assert.equal(verdict.conflict.resolution, "blocked_identity_conflict");
});

test("factsFromDiscovery records the override when inference differed from the site identity", () => {
  const input = freeformInput("Create a private preview for https://austinroofer.net/");
  const baseFacts = deriveFacts(input).facts;
  const merged = factsFromDiscovery(input, baseFacts, {
    facts: { name: "Austin Roofing Company", website: WEBSITE, services: [] },
    found: { services: [], contact: {} },
  });
  assert.equal(merged.name, "Austin Roofing Company");
  assert.ok(merged.name_override || merged.name_corroboration);
  assert.ok(!merged.name_conflict);
});

test("factsFromDiscovery blocks when an explicit hint contradicts the site identity", () => {
  const input = {
    description: "",
    sources: { website_url: WEBSITE },
    prospect_hints: { name: "Bob's Plumbing Service" },
  };
  const baseFacts = deriveFacts(input).facts;
  assert.equal(baseFacts.name_source, "hint");
  const merged = factsFromDiscovery(input, baseFacts, {
    facts: { name: "Austin Roofing Company", website: WEBSITE, services: [] },
    found: { services: [], contact: {} },
  });
  assert.ok(merged.name_conflict, "explicit hint vs site identity must record the conflict");
  assert.equal(merged.name_conflict.resolution, "blocked_identity_conflict");
});

// ------------------------------------------------------------- service floors

test("discovered services from the business's own pages survive the vertical allowlist", () => {
  const discovered = [
    "Roof Replacement", "Roof Repair", "Gutter Installation", "Storm Damage Repair",
    "Siding Repair", "Skylight Installation", "Chimney Repair", "Deck Building",
    "Fascia and Soffit", "Emergency Roof Tarping",
  ];
  const kept = cleanServicesWithProvenance(discovered, "roofing", "Austin Roofing Company", "", { provenance: "discovered" });
  // The real menu survives: allowlist hits AND specific source-bound labels.
  assert.equal(kept.length, discovered.length);
  assert.ok(kept.includes("Siding Repair"));
  assert.ok(kept.includes("Skylight Installation"));
  assert.ok(kept.includes("Chimney Repair"));
});

test("packet-CLAIMED services still require allowlist or literal evidence", () => {
  const claims = ["Roof Replacement", "Siding Repair", "Solar Panel Sales"];
  const kept = cleanServicesWithProvenance(claims, "roofing", "Austin Roofing Company", "", { provenance: "claimed" });
  // No evidence text: only the allowlist hit survives — donor contamination
  // stays out.
  assert.deepEqual(kept, ["Roof Replacement"]);
  const withEvidence = cleanServicesWithProvenance(claims, "roofing", "Austin Roofing Company",
    "We offer siding repair and solar panel sales.", { provenance: "claimed" });
  assert.equal(withEvidence.length, 3);
});
