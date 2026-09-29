import assert from "node:assert/strict";
import test from "node:test";

import { cacheKeyFor, normalizeInput } from "../lib/intake-genie-core.mjs";
import { buildRemixPacket } from "../lib/remix-packet.mjs";

const BASE_INPUT = {
  request_id: "req_viking",
  sources: {
    website_url: "https://vikingfence.example/",
    social_url: "https://instagram.com/vikingfence",
  },
  prospect_hints: {
    name: "Viking Fence",
    city: "Austin",
    state: "TX",
    category: "fencing",
    phone: "(512) 555-0188",
    address: "",
    services: ["Wood fencing", "Iron fencing"],
  },
  requirements: {
    site_type: "local-business",
    template: "authority-editorial",
    execution_mode: "review-first",
    page_plan: ["Home", "Services", "About", "Contact"],
    must_include: ["financing callout"],
    must_avoid: ["invented guarantees"],
  },
  brand_review: {
    verified: true,
    trusted_context: true,
    verification_source: "admin_review",
    logo_url: "https://vikingfence.example/assets/verified-logo.svg",
    colors: ["#183B32", "#D7A84B"],
    fonts: ["Oswald", "Inter"],
  },
};

const BASE_FACTS = {
  name: "Viking Fence",
  city: "Austin",
  state: "TX",
  category: "fencing",
  phone: "(512) 555-0188",
  services: ["Wood fencing", "Iron fencing"],
};

const BASE_DISCOVERY = {
  branding: {
    logo_url: "https://donor.example/old-logo.svg",
    colors: ["#FF00FF"],
    fonts: ["Comic Sans MS"],
  },
  source_registry: [
    { id: "website", type: "website", url: "https://vikingfence.example/", owner: "prospect", verified: true },
  ],
  media_inventory: [
    {
      kind: "image",
      url: "https://vikingfence.example/assets/crew.webp",
      provenance: { source_url: "https://vikingfence.example/gallery", owner_key: "viking-fence" },
    },
  ],
  navigation_pages: [
    { label: "Services", url: "https://vikingfence.example/services" },
  ],
};

const BASE_EVIDENCE = [
  { field: "name", value: "Viking Fence", source_type: "website", source_url: "https://vikingfence.example/" },
  { field: "phone", value: "(512) 555-0188", source_type: "hint", source_url: "" },
];

function compile(overrides = {}) {
  return buildRemixPacket({
    input: structuredClone(BASE_INPUT),
    facts: structuredClone(BASE_FACTS),
    discovery: structuredClone(BASE_DISCOVERY),
    evidence: structuredClone(BASE_EVIDENCE),
    ...overrides,
  });
}

test("remix packet preserves field and asset provenance without inventing unknown facts", () => {
  const packet = compile();

  assert.ok(Array.isArray(packet.source_registry));
  assert.ok(packet.source_registry.some((source) => source.url === "https://vikingfence.example/"));
  assert.equal(packet.prospect.name.value, "Viking Fence");
  assert.equal(packet.prospect.name.provenance.source_url, "https://vikingfence.example/");
  assert.equal(packet.prospect.address.value, null);
  assert.equal(packet.prospect.email.value, null);
  assert.ok(packet.readiness.warnings.some((warning) => /address/i.test(warning.code || warning)));
  assert.equal(JSON.stringify(packet).includes("info@vikingfence.example"), false);

  const crew = packet.media_inventory.find((asset) => asset.url.endsWith("/crew.webp"));
  assert.equal(crew.provenance.source_url, "https://vikingfence.example/gallery");
  assert.ok(packet.navigation_pages.some((page) => page.url.endsWith("/services")));
});

test("verified first-party brand review beats donor or template branding", () => {
  const packet = compile();

  assert.equal(packet.brand.logo.url, BASE_INPUT.brand_review.logo_url);
  assert.deepEqual(packet.brand.colors.map((color) => color.value), BASE_INPUT.brand_review.colors);
  assert.deepEqual(packet.brand.fonts.map((font) => font.value), BASE_INPUT.brand_review.fonts);
  assert.ok(packet.brand.colors.every((color) => color.provenance.verified === true));
  assert.equal(JSON.stringify(packet.brand).includes("donor.example"), false);
  assert.equal(JSON.stringify(packet.brand).includes("Comic Sans MS"), false);
});

test("canonical hash is deterministic and ignores compile time", () => {
  const first = compile({ compiled_at: "2026-08-25T01:00:00.000Z" });
  const second = compile({ compiled_at: "2026-08-26T12:34:56.000Z" });

  assert.match(first.canonical_hash, /^[a-f0-9]{64}$/);
  assert.equal(first.canonical_hash, second.canonical_hash);

  const changed = compile({
    input: { ...structuredClone(BASE_INPUT), requirements: { ...BASE_INPUT.requirements, must_include: ["financing callout", "warranty details"] } },
  });
  assert.notEqual(first.canonical_hash, changed.canonical_hash);
});

test("requirements survive compile and readiness names missing inputs", () => {
  const packet = compile();

  assert.equal(packet.requirements.template, "authority-editorial");
  assert.equal(packet.requirements.execution_mode, "review-first");
  assert.deepEqual(packet.requirements.page_plan, ["Home", "Services", "About", "Contact"]);
  assert.deepEqual(packet.requirements.must_avoid, ["invented guarantees"]);
  assert.ok(Number.isFinite(packet.readiness.score));
  assert.ok(packet.readiness.subscores && typeof packet.readiness.subscores === "object");
  assert.ok(packet.readiness.warnings.every((warning) => typeof warning.code === "string"));
});

test("compiled packets remain owner gated and never authorize prospect sends", () => {
  const packet = compile();

  assert.equal(packet.production_locks.owner_approval_required, true);
  assert.equal(packet.production_locks.send_allowed, false);
});

test("rendered verification stays false without explicit DOM evidence", () => {
  const unverified = compile();
  assert.equal(unverified.rendered_verification.required, true);
  assert.equal(unverified.rendered_verification.verified, false);

  const verified = compile({
    renderedEvidence: {
      verified: true,
      method: "playwright-dom",
      url: "https://preview.example/viking-fence",
      checked_at: "2026-08-25T18:57:29.000Z",
    },
  });
  assert.equal(verified.rendered_verification.verified, true);
  assert.equal(verified.rendered_verification.method, "playwright-dom");
});

test("rendered verification rejects caller assertions that are not real DOM proof", () => {
  const asserted = compile({
    renderedEvidence: {
      verified: true,
      method: "self-asserted",
      url: "https://preview.example/viking-fence",
    },
  });

  assert.equal(asserted.rendered_verification.verified, false);
  assert.equal(asserted.readiness.release_ready, false);
  assert.ok(asserted.warnings.some((warning) => warning.code === "rendered_verification_required"));
});

test("facts without matching field evidence are not attributed to the website", () => {
  const packet = buildRemixPacket({
    input: {
      sources: { website_url: "https://vikingfence.example/" },
      prospect_hints: { name: "Operator-entered Viking Fence" },
    },
    facts: {
      name: "Operator-entered Viking Fence",
      category: "fencing",
    },
    evidence: [],
  });

  assert.notEqual(packet.prospect.name.provenance.source_url, "https://vikingfence.example/");
  assert.notEqual(packet.prospect.category.provenance.source_url, "https://vikingfence.example/");
  assert.equal(packet.prospect.name.provenance.method, "operator_input");
});

test("template settings survive normalization and invalidate the compile cache", () => {
  const base = {
    description: "Viking Fence fencing in Austin, TX",
    website_url: "https://vikingfence.example/",
    requirements: {
      site_type: "local-business",
      template: "authority-editorial",
      execution_mode: "review-first",
      page_plan: ["Home"],
      settings: { hero_media: "video", density: "editorial" },
    },
  };
  const video = normalizeInput(base);
  const photo = normalizeInput({
    ...base,
    requirements: { ...base.requirements, settings: { ...base.requirements.settings, hero_media: "photo" } },
  });

  assert.deepEqual(video.requirements.settings, base.requirements.settings);
  assert.deepEqual(photo.requirements.settings, { hero_media: "photo", density: "editorial" });
  assert.notEqual(cacheKeyFor(video), cacheKeyFor(photo));
});

test("a caller-provided brand verified boolean cannot authenticate ownership", () => {
  const packet = buildRemixPacket({
    input: {
      sources: { website_url: "https://vikingfence.example/" },
      brand_review: {
        verified: true,
        logo_url: "https://donor.example/untrusted-logo.svg",
        colors: ["#FF00FF"],
        fonts: ["Comic Sans MS"],
      },
    },
    facts: { name: "Viking Fence", category: "fencing" },
  });

  assert.equal(packet.brand.logo?.provenance.verified, false);
  assert.ok(packet.brand.colors.every((color) => color.provenance.verified === false));
  assert.ok(packet.brand.fonts.every((font) => font.provenance.verified === false));
});

test("every readiness component that loses points emits an actionable warning", () => {
  const packet = buildRemixPacket({
    input: {
      sources: { website_url: "https://vikingfence.example/" },
      requirements: { site_type: "local-business", template: "authority-editorial" },
    },
    facts: { name: "Viking Fence", city: "Austin", state: "TX", category: "fencing", services: ["Wood fencing"] },
  });
  const warningFields = new Set(packet.warnings.map((warning) => warning.field));

  assert.equal(packet.readiness.subscores.brand_assets < 100, true);
  assert.equal(packet.readiness.subscores.requirements < 100, true);
  assert.ok(warningFields.has("brand.logo"));
  assert.ok(warningFields.has("brand.colors"));
  assert.ok(warningFields.has("brand.fonts"));
  assert.ok(warningFields.has("brand.media"));
  assert.ok(warningFields.has("requirements.execution_mode"));
  assert.ok(warningFields.has("requirements.page_plan"));
});
