import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const { compilePacket } = require(join(repoRoot, "api", "compile-build-packet.js"));

function sha256Utf8(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function richPacket() {
  return {
    business: {
      businessName: "Fixture Plumbing",
      category: "plumbing",
      serviceArea: "Reno, NV",
      phone: "(775) 555-0100",
      email: "hello@fixture-plumbing.example",
      hours: "Monday-Friday, 8 AM-5 PM",
      mainCta: "Request service",
      mainServices: "Drain Cleaning\nWater Heater Repair",
      exactServices: "Drain Cleaning\nWater Heater Repair"
    },
    brand: {
      logoLink: "https://fixture-plumbing.example/logo.svg",
      galleryLink: "https://fixture-plumbing.example/work.webp"
    },
    goldenArtifacts: {
      exactServices: ["Drain Cleaning", "Water Heater Repair"]
    },
    assetQa: {
      logoCandidates: ["https://fixture-plumbing.example/logo.svg"],
      imageCandidates: ["https://fixture-plumbing.example/work.webp"]
    },
    pagePlan: [
      { title: "Home", slug: "" },
      { title: "Drain Cleaning", slug: "services/drain-cleaning" },
      { title: "About", slug: "about" },
      { title: "Contact", slug: "contact" }
    ]
  };
}

test("emits the exact CertifiedPracticePacket/v1 visitor-copy contract with stable UTF-8 hashes", () => {
  const first = compilePacket(richPacket());
  const second = compilePacket(richPacket());
  const contract = first.compiled.contentContract;

  assert.deepEqual(Object.keys(contract), [
    "schema",
    "kind",
    "version",
    "facts",
    "assets",
    "builder_instructions",
    "visitor_copy"
  ]);
  assert.equal(contract.schema, "CertifiedPracticePacket/v1");
  assert.equal(contract.kind, "certified_practice_packet");
  assert.equal(contract.version, 1);
  assert.equal(contract.facts.category, "plumbing");
  assert.equal(Object.hasOwn(contract.facts, "vertical"), false);
  assert.deepEqual(contract.facts.services, ["Drain Cleaning", "Water Heater Repair"]);
  assert.deepEqual(contract.builder_instructions, { public: false });
  assert.equal(contract.assets.publication_policy, "candidate_only_until_downstream_ownership_verification");

  const visitor = contract.visitor_copy;
  assert.equal(visitor.kind, "visitor_copy");
  assert.deepEqual(visitor.safety, { pass: true, violations: [] });
  assert.ok(Object.keys(visitor.files).length >= 8);
  assert.equal(Object.hasOwn(visitor.files, "content/content-quality-report.json"), false);
  assert.deepEqual(visitor.file_hashes, second.compiled.contentContract.visitor_copy.file_hashes);

  for (const [path, content] of Object.entries(visitor.files)) {
    assert.match(path, /^content\/.*\.md$/);
    assert.equal(content, first.compiled.contentFiles[path]);
    assert.match(visitor.file_hashes[path], /^[0-9a-f]{64}$/);
    assert.equal(visitor.file_hashes[path], sha256Utf8(content));
  }
});

test("visitor copy is customer-facing, short, and contains no retired word-count padding", () => {
  const compiled = compilePacket(richPacket()).compiled;
  const files = compiled.contentContract.visitor_copy.files;
  const allVisitorCopy = Object.values(files).join("\n");

  assert.doesNotMatch(allVisitorCopy, /site builder|builder instructions?|selected template|intake packet|protected service|finished site|page should|copy should|content is generated/i);
  assert.doesNotMatch(allVisitorCopy, /More detail for|verified phone number|verified email address|hours need review|the local service area|the local market/i);
  assert.match(files["content/home.md"], /Fixture Plumbing offers Drain Cleaning and Water Heater Repair in Reno, NV\./);
  assert.match(files["content/services/drain-cleaning.md"], /When you get in touch, share the service location/i);
  assert.ok(files["content/home.md"].split(/\s+/).length < 150);
  assert.ok(files["content/services/drain-cleaning.md"].split(/\s+/).length < 180);
  assert.equal(compiled.contentQuality.reviewCount, 0);
  assert.ok(compiled.contentQuality.files.every(file => file.targetWords === 0 && file.status === "pass"));
});

test("sparse certified facts stay sparse without placeholder facts or invented services", () => {
  const compiled = compilePacket({
    business: {
      businessName: "Quiet Handyman",
      category: "handyman"
    }
  }).compiled;
  const contract = compiled.contentContract;
  const files = contract.visitor_copy.files;
  const copy = Object.values(files).join("\n");

  assert.equal(contract.facts.category, "handyman");
  assert.equal(Object.hasOwn(contract.facts, "services"), false);
  assert.equal(contract.visitor_copy.safety.pass, true);
  assert.equal(Object.keys(files).some(path => /content\/(?:services|blog)\//.test(path)), false);
  assert.match(files["content/home.md"], /Contact Quiet Handyman to ask about available services\./);
  assert.doesNotMatch(copy, /verified local services|verified phone number|verified email address|hours need review|local service area|Drain Cleaning|Water Heater Repair/i);
  assert.ok(Object.values(files).every(content => content.split(/\s+/).length < 100));
});

test("visitor contract canonicalizes a supported category while retaining its source label", () => {
  const compiled = compilePacket({
    business: {
      businessName: "Acme Roofing",
      category: "Roofing contractor",
    },
  }).compiled;

  assert.equal(compiled.contentContract.facts.category, "roofing");
  assert.equal(compiled.contentContract.facts.category_label, "Roofing contractor");
});

test("safety failures identify the public file and rule", () => {
  const compiled = compilePacket({
    business: {
      businessName: "Site Builder",
      category: "handyman"
    }
  }).compiled;
  const safety = compiled.contentContract.visitor_copy.safety;

  assert.equal(safety.pass, false);
  assert.ok(safety.violations.length > 0);
  assert.ok(safety.violations.every(violation => (
    typeof violation.file === "string" && typeof violation.rule === "string"
  )));
  assert.ok(safety.violations.some(violation => (
    violation.file === "content/home.md" && violation.rule === "builder_instruction_language"
  )));
});

test("active markup, unsafe Markdown URLs, remote images, and bidi controls never enter visitor copy", () => {
  const cases = [
    {
      businessName: "<script>alert(1)</script><img src=x onerror=alert(2)> Acme Home Care",
      expectedName: "Acme Home Care",
      forbidden: /<script|<img|onerror|alert\(/i
    },
    {
      businessName: "[Unsafe](data:text/html,hello)",
      expectedName: "Unsafe",
      forbidden: /data\s*:|\]\(/i
    },
    {
      businessName: "[Unsafe](vbscript:msgbox(1))",
      expectedName: "Unsafe",
      forbidden: /vbscript\s*:|\]\(/i
    },
    {
      businessName: "![logo](https://competitor.example/pixel.png) Acme Home Care",
      expectedName: "Acme Home Care",
      forbidden: /competitor\.example|!\[/i
    },
    {
      businessName: "Acme\u202Egnifo",
      expectedName: "Acmegnifo",
      forbidden: /[\u202a-\u202e\u2066-\u2069]/
    }
  ];

  for (const sample of cases) {
    const contract = compilePacket({
      business: {
        businessName: sample.businessName,
        category: "handyman"
      }
    }).compiled.contentContract;
    const publicContract = JSON.stringify({
      facts: contract.facts,
      visitor_copy: contract.visitor_copy
    });

    assert.equal(contract.facts.business_name, sample.expectedName);
    assert.doesNotMatch(publicContract, sample.forbidden);
    assert.equal(contract.visitor_copy.safety.pass, true);
  }
});

test("visitor facts strip HTML and must-avoid residue cannot become a service", () => {
  const compiled = compilePacket({
    business: {
      businessName: "<img src=x onerror=alert(1)> Acme Home Care",
      category: "home_services",
      exactServices: "D-Lux Pools Repair\nFixture Repair"
    },
    requirements: {
      mustAvoid: "D-Lux Pools"
    },
    pagePlan: [
      { title: "Home", slug: "" },
      { title: "D-Lux Pools Repair", slug: "services/d-lux-pools-repair" },
      { title: "Fixture Repair", slug: "services/fixture-repair" }
    ]
  }).compiled;
  const contract = compiled.contentContract;
  const copy = Object.values(contract.visitor_copy.files).join("\n");

  assert.equal(contract.facts.business_name, "Acme Home Care");
  assert.deepEqual(contract.facts.services, ["Fixture Repair"]);
  assert.equal(contract.visitor_copy.safety.pass, true);
  assert.doesNotMatch(copy, /<img|onerror|D-Lux Pools/i);
  assert.equal(Object.hasOwn(contract.visitor_copy.files, "content/services/d-lux-pools-repair.md"), false);
});

test("non-service financing labels never become visitor services", () => {
  const compiled = compilePacket({
    business: {
      businessName: "Acme Home Care",
      category: "home_services",
      exactServices: "Financing Available\nFixture Repair"
    }
  }).compiled;
  const contract = compiled.contentContract;
  const copy = Object.values(contract.visitor_copy.files).join("\n");

  assert.deepEqual(contract.facts.services, ["Fixture Repair"]);
  assert.doesNotMatch(copy, /Financing Available/i);
  assert.equal(contract.visitor_copy.safety.pass, true);
});

test("page plans and requirements cannot certify a public service claim", () => {
  const compiled = compilePacket({
    business: {
      businessName: "Acme Roofing",
      category: "roofing",
      serviceArea: "Reno, NV"
    },
    requirements: {
      pagesNeeded: "Commercial Roofing"
    },
    pagePlan: [
      { title: "Home", slug: "" },
      { title: "Commercial Roofing", slug: "services/commercial-roofing" }
    ]
  }).compiled;
  const contract = compiled.contentContract;
  const copy = Object.values(contract.visitor_copy.files).join("\n");

  assert.equal(Object.hasOwn(contract.facts, "services"), false);
  assert.doesNotMatch(copy, /Acme Roofing offers Commercial Roofing/i);
  assert.equal(Object.hasOwn(contract.visitor_copy.files, "content/services/commercial-roofing.md"), false);
  assert.equal(contract.visitor_copy.safety.pass, true);
});
