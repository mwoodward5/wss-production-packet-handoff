import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  deriveFacts,
  detectScope,
  normalizeInput,
  normalizeCategory,
  normalizeUrl,
  cacheKeyFor,
  validateCanonicalPacket,
  buildCanonicalPacket,
  evidenceForFacts,
  shouldDiscoverBeforeScope,
} from "../lib/intake-genie-core.mjs";
import { familyForBusiness, previewFamilyForBusiness } from "../lib/intake-genie.mjs";

assert.equal(normalizeUrl("Example.com/#top"), "https://example.com/");
assert.throws(() => normalizeUrl("http://127.0.0.1:8787/test"), /Private-network/);

const promptSources = normalizeInput({
  description: "Build Landscape Connection in Clovis, CA landscaping. Website https://example.com and Instagram https://instagram.com/example",
});
assert.equal(promptSources.sources.website_url, "https://example.com/");
assert.equal(promptSources.sources.social_url, "https://instagram.com/example");

const verifiedContact = normalizeInput({
  name: "Barriga Landscaping",
  city: "Sacramento",
  state: "CA",
  category: "landscaping",
  phone: "(916) 926-8639",
  address: "2805 Wah Ave, Sacramento, CA 95822",
  gbp_url: "https://www.google.com/maps?cid=16221758651586694875",
});
const verifiedFacts = deriveFacts(verifiedContact).facts;
assert.equal(verifiedFacts.phone, "(916) 926-8639");
assert.equal(verifiedFacts.address, "2805 Wah Ave, Sacramento, CA 95822");
assert.deepEqual(
  evidenceForFacts(verifiedContact, verifiedFacts).filter(({ field }) => ["phone", "address"].includes(field)).map(({ source_type }) => source_type),
  ["hint", "hint"],
);

const spokenVerified = normalizeInput({
  description: "Barriga Landscaping in Sacramento, California. Verified services: lawn care, sprinkler checks, and cleanup visits. Verified phone: (916) 926-8639. Verified address: 2805 Wah Ave, Sacramento, CA 95822.",
});
const spokenFacts = deriveFacts(spokenVerified).facts;
assert.equal(spokenFacts.name, "Barriga Landscaping");
assert.equal(spokenFacts.phone, "(916) 926-8639");
assert.equal(spokenFacts.address, "2805 Wah Ave, Sacramento, CA 95822");
assert.deepEqual(spokenFacts.services, ["lawn care", "sprinkler checks", "cleanup visits"]);

const input = normalizeInput({
  website_url: "https://cedarstone.example/services",
  description: "Cedar Stone Hardscapes landscaping in Fort Collins, CO. Paver patios, outdoor kitchens, and drainage fixes.",
});
const { facts, missing } = deriveFacts(input);
assert.equal(facts.name, "Cedar Stone Hardscapes");
assert.equal(facts.city, "Fort Collins");
assert.equal(facts.state, "CO");
assert.equal(facts.category, "landscaping");
assert.deepEqual(missing, []);

// Category-default service menus: honest fallbacks for prose-heavy vertical
// sites where the scraper finds no service list (the universal top-5 blocker).
const { categoryDefaultServices } = await import("../lib/intake-genie-core.mjs");
for (const cat of ["med spa", "dental", "tattoo studio", "photographer", "piercing", "attorney", "hair salon", "barber", "nail studio", "massage", "wedding vendor"]) {
  assert.ok(categoryDefaultServices(cat).length >= 3, `${cat} has a default service menu`);
}
assert.deepEqual(categoryDefaultServices("roofing"), [], "trades keep scrape-only services (no default menu)");

// Ghost's donor registry names the Lacquer Studio vertical "salon". It must
// enter the compiler as the canonical hair-salon category and retain the
// category-standard menu when the source contains no service list.
const salonInput = normalizeInput({
  name: "Lacquer Studio",
  city: "Austin",
  state: "TX",
  category: "salon",
  website_url: "https://lacquer-studio.example/",
});
assert.equal(salonInput.prospect_hints.category, "hair salon");
assert.equal(normalizeCategory("salon"), "hair salon");
const salonFacts = deriveFacts(salonInput).facts;
assert.equal(salonFacts.category, "hair salon");
const salonPacket = buildCanonicalPacket({
  input: salonInput,
  facts: { ...salonFacts, services: [], services_source: "" },
  evidence: evidenceForFacts(salonInput, salonFacts),
});
assert.deepEqual(salonPacket.facts.services, categoryDefaultServices("hair salon"));
assert.equal(salonPacket.facts.services_source, "category default");

// High-value verticals are now first-class supported categories (owner priority).
const dentist = normalizeInput({ description: "Bright Smile Dental dentist in Plano, TX" });
assert.equal(detectScope(dentist).supported, true);
assert.equal(detectScope(dentist).category, "dental");
const medspa = normalizeInput({ description: "Glow Med Spa botox and filler in Scottsdale, AZ" });
assert.equal(detectScope(medspa).category, "med spa"); // never the pool-service "spa"
const lawyer = normalizeInput({ description: "Smith & Co law firm attorney in Dallas, TX" });
assert.equal(detectScope(lawyer).supported, true);
// A genuine restaurant is still correctly out of scope.
const restaurant = normalizeInput({ description: "Tonys Pizzeria italian restaurant in Denver, CO" });
assert.equal(detectScope(restaurant).supported, false);

const websiteOnly = normalizeInput({ website_url: "https://unknown-local-business.example" });
assert.equal(shouldDiscoverBeforeScope(websiteOnly, detectScope(websiteOnly)), true);

const concatenatedTradeDomain = normalizeInput({ website_url: "https://richarddiazlandscaping.com/" });
assert.equal(detectScope(concatenatedTradeDomain).category, "landscaping");

const tattooPublicSource = normalizeInput({
  website_url: "https://blacklanternink.example/",
  social_url: "https://instagram.com/blacklanternink",
  name: "Black Lantern Ink",
  city: "Austin",
  state: "TX",
  description: "Black Lantern Ink is a tattoo studio and tattoo artist shop in Austin, TX.",
  services: ["custom tattoos", "flash tattoos"],
});
const tattooFacts = deriveFacts(tattooPublicSource).facts;
for (const tattooSignal of ["tattoo", "tattooing", "tattoo artist", "tattoo studio", "tattoo shop", "body art"]) {
  assert.equal(normalizeCategory(tattooSignal), "tattoo studio");
}
for (const ambiguousSignal of ["artist portfolio", "body artist", "design studio", "repair shop", "Ink LLC"]) {
  assert.equal(normalizeCategory(ambiguousSignal), "");
}
assert.equal(detectScope(tattooPublicSource).supported, true);
assert.equal(tattooFacts.category, "tattoo studio");
assert.deepEqual(deriveFacts(tattooPublicSource).missing, []);
assert.ok(["split-editorial-index", "cinematic-video-parallax", "magazine-owner-letter"].includes(familyForBusiness(tattooFacts)));
assert.equal(previewFamilyForBusiness(tattooFacts), familyForBusiness(tattooFacts));
assert.equal(previewFamilyForBusiness({ ...tattooFacts, category: "roofing" }), "auto");
assert.equal(evidenceForFacts(tattooPublicSource, tattooFacts).some(({ field, source_type, source_url }) => field === "website" && source_type === "website" && source_url === "https://blacklanternink.example/"), true);

const compactTattooDomain = normalizeInput({ website_url: "https://blacklanterntattoostudio.com/" });
assert.equal(detectScope(compactTattooDomain).category, "tattoo studio");
for (const nonTattooDomain of ["artistportfolio.com", "bodyartist.com", "designstudio.com", "repairshop.com", "inkllc.com"]) {
  assert.equal(detectScope(normalizeInput({ website_url: `https://${nonTattooDomain}/` })).category, "");
}

const needsLocation = normalizeInput({ description: "Cedar Stone Hardscapes landscaping" });
assert.deepEqual(deriveFacts(needsLocation).missing, ["location"]);
assert.notEqual(
  cacheKeyFor(normalizeInput({ description: "Cedar Stone Hardscapes landscaping in Fort Collins, CO" })),
  cacheKeyFor(normalizeInput({ description: "Woodward Pool Builders pool service in Mission Viejo, CA" })),
);

const packet = buildCanonicalPacket({
  input,
  facts,
  evidence: evidenceForFacts(input, facts),
  preview: { job_id: "job_test", url: "/try/test/" },
});
assert.equal(validateCanonicalPacket(packet).ok, true);
assert.equal(packet.version, "intake-genie-v2");
assert.equal(packet.optimization.target_queries.length <= 6, true);

// Rich discovery facts are optional additions to the established canonical
// shape. Preserve useful source material for V8/Fable rather than dropping it
// while still allowing basic-only callers above to work unchanged.
const richPacket = buildCanonicalPacket({
  input,
  facts: {
    ...facts,
    copy: "   ",
    testimonials: [],
    founded: 0,
    branding: { colors: [], fonts: [] },
  },
  discovery: {
    copy: "Cedar Stone builds paver patios and outdoor kitchens in Fort Collins.",
    testimonials: [{ author: "Ana P.", text: "The patio is exactly what we wanted." }],
    founded: 2008,
    branding: { colors: ["#1B4B5A", "#E8A33D"], fonts: ["Fraunces", "Inter"] },
    found: { copy: "Older duplicate copy should not win." },
  },
  evidence: evidenceForFacts(input, facts),
});
assert.equal(richPacket.facts.copy, "Cedar Stone builds paver patios and outdoor kitchens in Fort Collins.");
assert.deepEqual(richPacket.facts.testimonials, [{ author: "Ana P.", text: "The patio is exactly what we wanted." }]);
assert.equal(richPacket.facts.founded, 2008);
assert.deepEqual(richPacket.facts.branding, { colors: ["#1B4B5A", "#E8A33D"], fonts: ["Fraunces", "Inter"] });
assert.equal(richPacket.facts.discovery.copy, "Cedar Stone builds paver patios and outdoor kitchens in Fort Collins.");
assert.equal(richPacket.discovery.copy, "Cedar Stone builds paver patios and outdoor kitchens in Fort Collins.");
assert.deepEqual(richPacket.branding.fonts, ["Fraunces", "Inter"]);

// Fresh explicit facts remain authoritative when a cached discovery payload is
// stale, and empty explicit fields fall back to the fresh discovery payload.
const preservationPacket = buildCanonicalPacket({
  input,
  facts: {
    ...facts,
    copy: "Verified current copy.",
    testimonials: [{ author: "Current customer", text: "Excellent work." }],
    founded: 1998,
    branding: { colors: ["#123456"], fonts: ["Current Sans"] },
    discovery: {
      stale: true,
      copy: "Stale copy.",
      testimonials: [{ author: "Old customer", text: "Old review." }],
      founded: 1980,
      branding: { colors: ["#ABCDEF"], fonts: ["Old Serif"] },
    },
  },
  evidence: evidenceForFacts(input, facts),
});
assert.equal(preservationPacket.facts.copy, "Verified current copy.");
assert.deepEqual(preservationPacket.facts.testimonials, [{ author: "Current customer", text: "Excellent work." }]);
assert.equal(preservationPacket.facts.founded, 1998);
assert.deepEqual(preservationPacket.facts.branding, { colors: ["#123456"], fonts: ["Current Sans"] });
assert.deepEqual(preservationPacket.facts.discovery, {});

const tattooPacket = buildCanonicalPacket({
  input: tattooPublicSource,
  facts: tattooFacts,
  evidence: evidenceForFacts(tattooPublicSource, tattooFacts),
});
assert.equal(validateCanonicalPacket(tattooPacket).ok, true);

// Raw scrape headings must not undo the cleaned service list before certification.
const concreteServices = ["Concrete Driveways", "Concrete Patios", "Concrete Steps & Walkways"];
const rejectedHeadings = ["Concrete That Holds Up inLos Angeles Clay", "Clean Site Every Day", "Allied Concrete Solutions"];
const concretePacket = buildCanonicalPacket({
  input: normalizeInput({ name: "Allied Concrete Solutions", city: "Los Angeles", state: "CA", category: "concrete", website_url: "https://losangelesconcretecompany.com/" }),
  facts: { name: "Allied Concrete Solutions", city: "Los Angeles", state: "CA", category: "concrete", services: [...concreteServices, "Unobserved Service"] },
  discovery: {
    sources: ["https://losangelesconcretecompany.com/"],
    found: { services: [...rejectedHeadings, ...concreteServices], copy: [...rejectedHeadings, ...concreteServices].join("\n") },
  },
});
assert.equal(concretePacket.facts.services_source, "category default");
assert.equal(concretePacket.evidence.some((item) => item.field === "services" && item.provenance === "observed"), false);
assert.equal(Object.keys(concretePacket.content.content_contract.visitor_copy.files)
  .some((path) => path.startsWith("content/services/")), false);
const visitorCopy = concretePacket.content.content_contract.visitor_copy;
const homeCopy = visitorCopy.files["content/home.md"];
for (const heading of rejectedHeadings.slice(0, 2)) assert.ok(!homeCopy.includes(heading));
assert.ok(!homeCopy.includes("Unobserved Service"));
assert.equal(visitorCopy.file_hashes["content/home.md"], createHash("sha256").update(homeCopy).digest("hex"));

console.log("Intake Genie core tests: passed");
