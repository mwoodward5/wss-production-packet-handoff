"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { preflight } = require("../api/lib/packet2-import");
const route = require("../api/intake-genie-import-packet2");

const sha = value => createHash("sha256").update(value).digest("hex");
const identity = {
  prospect_id: "prospect-concrete-1",
  request: {
    request_id: "ghost:prospect-concrete-1:line-genie-certified-v7",
    website_url: "https://www.exampleconcrete.com/",
    prospect_hints: { city: "Tulsa", state: "OK", category: "concrete" },
    mode: "full", build_preview: false, dry_run: true, corrections: {},
  },
};
function snapshot(change = () => {}) {
  const service = "Concrete Driveways";
  const sourceUrl = identity.request.website_url;
  const archive = "# Example Concrete\nTulsa, OK concrete contractor.\n## Concrete Driveways\nWe install concrete driveways in Tulsa, OK.";
  const file = "content/services/concrete-driveways.md";
  const body = "# Concrete Driveways\nExample Concrete installs concrete driveways in Tulsa, OK.";
  const archiveFile = "content/source-pages/home.md";
  const observation = {
    source: sourceUrl, status: "succeeded",
    extracted: { brandName: "Example Concrete", domainUrl: sourceUrl, address: "Tulsa, OK",
      exactServices: service, mainServices: service },
    private_source: { markdown: archive },
  };
  const p = {
    version: "2.0",
    business: { businessName: "Example Concrete", domainUrl: sourceUrl,
      city: "Tulsa", state: "OK", category: "concrete" },
    sources: { urls: [sourceUrl], observations: [observation],
      extracted: observation.extracted, intakeRequest: identity.request },
    compiled: {
      services: [{ name: service, providerName: "Example Concrete" }],
      contentFiles: { [file]: body, [archiveFile]: archive },
      sourceContent: { pages: [{ sourceUrl, file: archiveFile, sha256: sha(archive),
        publicationPolicy: "private_source_reference_only" }] },
      routeContentMap: [{ route: "/services", contentFiles: [file], sourceContentFiles: [archiveFile] }],
      contentQuality: { status: "pass", visitor: { totalFiles: 1, passCount: 1, reviewCount: 0,
        files: [{ sourcePath: file, status: "pass", reasons: [] }] } },
      contentContract: { schema: "CertifiedPracticePacket/v1",
        facts: { category: "concrete", services: [service] },
        visitor_copy: { kind: "visitor_copy", files: { [file]: body },
          file_hashes: { [file]: sha(body) }, safety: { pass: true, violations: [] } } },
    },
  };
  change(p);
  const bytes = Buffer.from(JSON.stringify(p));
  return { ...identity, snapshot_base64: bytes.toString("base64"), snapshot_sha256: sha(bytes) };
}

test("preflight accepts internally bound, source-backed service fixture", () => {
  const result = preflight(snapshot());
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.required_urls, [identity.request.website_url]);
});
for (const [name, mutate, reason] of [
  ["polluted provider", p => { p.compiled.services[0].providerName = "Other Concrete"; }, "polluted_service_provider"],
  ["unsafe visitor file", p => { p.compiled.contentContract.visitor_copy.safety.pass = false; }, "visitor_files_unsafe"],
  ["missing visitor quality", p => { delete p.compiled.contentQuality.visitor; }, "visitor_quality_not_passed"],
  ["aggregate review despite passed visitor files", p => { p.compiled.contentQuality.status = "review"; }, "aggregate_quality_not_passed"],
  ["invalid visitor hash", p => { p.compiled.contentContract.visitor_copy.file_hashes["content/services/concrete-driveways.md"] = "0".repeat(64); }, "visitor_files_unsafe"],
  ["wrong business identity", p => { p.business.businessName = "Other Concrete"; }, "source_identity_unproven"],
]) {
  test(`preflight rejects ${name}`, () => {
    assert.equal(preflight(snapshot(mutate)).reason, reason);
  });
}
test("preflight rejects oversized snapshot before parsing", () => {
  const input = snapshot();
  input.snapshot_base64 = Buffer.alloc(2_000_001, 65).toString("base64");
  input.snapshot_sha256 = sha(Buffer.from(input.snapshot_base64, "base64"));
  assert.equal(preflight(input).reason, "snapshot_bytes_invalid");
});
function withServiceLabel(label, sourceLine) {
  return snapshot(p => {
    const original = "Concrete Driveways";
    p.compiled.contentContract.facts.services = [label];
    p.compiled.services[0].name = label;
    p.sources.observations[0].extracted.exactServices = label;
    p.sources.observations[0].extracted.mainServices = label;
    p.sources.extracted.exactServices = label;
    p.sources.extracted.mainServices = label;
    const source = p.sources.observations[0].private_source.markdown
      .replace(`## ${original}\nWe install concrete driveways in Tulsa, OK.`, sourceLine);
    p.sources.observations[0].private_source.markdown = source;
    p.compiled.contentFiles["content/source-pages/home.md"] = source;
    p.compiled.sourceContent.pages[0].sha256 = sha(source);
  });
}
for (const label of ["Services ▾", "Why Choose Arrow Fence", "How much does concrete curbing cost?", "Fencing Tulsa Since 1979"]) {
  test(`preflight refuses navigation, editorial, or slogan service label: ${label}`, () => {
    const result = preflight(withServiceLabel(label, `## ${label}\nThis heading appears on the business website.`));
    assert.equal(result.ok, false, `accepted polluted service label ${label}`);
  });
}
test("preflight refuses a service label merely mentioned in source prose", () => {
  const result = preflight(withServiceLabel("Concrete Driveways",
    "## About\nCustomers ask us about Concrete Driveways, but we do not offer them."));
  assert.equal(result.ok, false, "accepted a negative prose mention as offered service");
});
test("preflight refuses a bare service navigation link without an offer description", () => {
  const result = preflight(withServiceLabel("Concrete Driveways",
    "## Services\n[Concrete Driveways - Learn More](/services/concrete-driveways)"));
  assert.equal(result.ok, false, "accepted a navigation link as an offered service");
});
test("preflight refuses a standalone FAQ mention without an offer description", () => {
  const result = preflight(withServiceLabel("Concrete Driveways",
    "## Frequently Asked Questions\n### What about Concrete Driveways?\nAsk a contractor whether this option suits your property."));
  assert.equal(result.ok, false, "accepted an FAQ topic as an offered service");
});
function response() {
  return { headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; } };
}
test("import route refuses unauthenticated and malformed snapshots", async () => {
  const handler = route.createHandler({ env: { INTAKE_GENIE_TOKEN: "owner-token" },
    importPacket2: async () => { throw Error("must not import"); } });
  const denied = response();
  await handler({ method: "POST", headers: {}, body: snapshot() }, denied);
  assert.equal(denied.code, 401);
  const malformed = response();
  await handler({ method: "POST", headers: { authorization: "Bearer owner-token" }, body: "{" }, malformed);
  assert.equal(malformed.code, 400);
});
