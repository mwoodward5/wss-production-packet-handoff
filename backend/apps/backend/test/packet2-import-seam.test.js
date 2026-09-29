"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  callIntakeGenie,
  createContentCertification,
  prospectRequest,
  verifyContentCertification,
} = require("../lib/intake-genie-client");

const sha = value => createHash("sha256").update(value).digest("hex");
const prospect = {
  prospect_id: "packet2-acme-1", business_name: "Acme Plumbing",
  city: "Reno", state: "NV", industry: "plumbing",
  website: "https://acme-plumbing.example",
};
const source = "https://acme-plumbing.example/services";
const serviceFile = "content/services/drain-cleaning.md";
const serviceBody = "# Drain Cleaning\n\nAcme Plumbing offers drain cleaning in Reno.";
const snapshotBytes = Buffer.from('{"version":"2.0","test":true}');
const snapshot = {
  snapshot_base64: snapshotBytes.toString("base64"),
  snapshot_sha256: sha(snapshotBytes),
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status,
    text: async () => JSON.stringify(body) };
}

function importedPacket(request) {
  const contract = {
    schema: "CertifiedPracticePacket/v1", kind: "certified_practice_packet",
    version: 1, facts: { category: "plumbing", services: ["Drain Cleaning"] },
    builder_instructions: { public: false },
    visitor_copy: { kind: "visitor_copy", files: { [serviceFile]: serviceBody },
      file_hashes: { [serviceFile]: sha(serviceBody) },
      safety: { pass: true, violations: [] } },
  };
  const visitorFile = { sourcePath: serviceFile, status: "pass", reasons: [] };
  const quality = { status: "pass", totalFiles: 1, passCount: 1, reviewCount: 0,
    visitor: { totalFiles: 1, passCount: 1, files: [visitorFile] } };
  return {
    ok: true, version: "intake-genie-v2", status: "compiled",
    scope: { supported: true, category: "plumbing" },
    request_id: request.request_id, job_id: "pagehub:packet2-acme-1",
    facts: { name: "Acme Plumbing", city: "Reno", state: "NV",
      category: "plumbing", services: ["Drain Cleaning"] },
    evidence: [{ field: "name", value: "Acme Plumbing", source_url: source }],
    service_evidence: [{ field: "services", value: "Drain Cleaning", source_url: source,
      source_observations: [source], provenance: "observed", verification_status: "source_observation" }],
    source_match: { version: "server-exact-source-match-v1",
      pages: [source], matched_count: 1, category_source_url: source },
    packet2: { compiled: { contentContract: contract, contentQuality: quality } },
    packet2_hash: "b".repeat(64),
    content: { content_contract: contract, content_quality: quality,
      content_files: { [serviceFile]: serviceBody } },
    transport_receipt: { version: "owner-packet2-import-v1",
      snapshot_sha256: snapshot.snapshot_sha256, packet2_hash: "b".repeat(64) },
  };
}

function withEnv(t, values) {
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("Packet2 import fails closed when PACKET2_IMPORT_BASE_URL is absent", async t => {
  const beforeFetch = global.fetch;
  withEnv(t, {
    INTAKE_GENIE_BASE_URL: "http://wss-local-compiler:8787",
    PACKET2_IMPORT_BASE_URL: undefined,
    INTAKE_GENIE_TOKEN: "test-only-token",
  });
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error("must not fetch"); };
  t.after(() => { global.fetch = beforeFetch; });
  const result = await callIntakeGenie(prospect, { packet2Import: snapshot });
  assert.equal(result.ok, false);
  assert.equal(result.status, "not_configured");
  assert.match(result.error, /PACKET2_IMPORT_BASE_URL/);
  assert.equal(calls, 0);
});

test("ordinary compile remains on INTAKE_GENIE_BASE_URL", async t => {
  const beforeFetch = global.fetch;
  withEnv(t, {
    INTAKE_GENIE_BASE_URL: "http://wss-local-compiler:8787",
    PACKET2_IMPORT_BASE_URL: "http://host.docker.internal:18900",
    INTAKE_GENIE_TOKEN: "test-only-token",
  });
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return response(200, importedPacket(calls.at(-1).body));
  };
  t.after(() => { global.fetch = beforeFetch; });
  const result = await callIntakeGenie(prospect, { buildPreview: false, dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://wss-local-compiler:8787/api/intake-genie/compile");
});

test("valid Packet2 import uses dedicated PageHub base and preserves packet", async t => {
  const beforeFetch = global.fetch;
  withEnv(t, {
    INTAKE_GENIE_BASE_URL: "http://wss-local-compiler:8787",
    PACKET2_IMPORT_BASE_URL: "http://host.docker.internal:18900",
    INTAKE_GENIE_TOKEN: "test-only-token",
  });
  const calls = [];
  let expectedImported;
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    expectedImported = importedPacket(calls.at(-1).body.request);
    return response(200, expectedImported);
  };
  t.after(() => { global.fetch = beforeFetch; });
  const imported = await callIntakeGenie(prospect, {
    buildPreview: false, dryRun: true, packet2Import: snapshot,
  });
  assert.equal(imported.ok, true, JSON.stringify(imported));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://host.docker.internal:18900/api/intake-genie-import-packet2");
  assert.equal(calls[0].body.snapshot_base64, snapshot.snapshot_base64);
  assert.equal(calls[0].body.snapshot_sha256, snapshot.snapshot_sha256);
  assert.equal(calls[0].body.prospect_id, prospect.prospect_id);
  assert.deepEqual(calls[0].body.request, prospectRequest(prospect, {
    buildPreview: false, dryRun: true, pipelineVersion: "line-genie-certified-v7",
  }));
  assert.deepEqual(imported.packet, expectedImported);
});

test("Packet2 import rejects transport, source-match, and service-evidence tamper", async t => {
  const beforeFetch = global.fetch;
  withEnv(t, {
    INTAKE_GENIE_BASE_URL: "http://wss-local-compiler:8787",
    PACKET2_IMPORT_BASE_URL: "http://host.docker.internal:18900",
    INTAKE_GENIE_TOKEN: "test-only-token",
  });
  t.after(() => { global.fetch = beforeFetch; });
  const cases = [
    ["snapshot", packet => { packet.transport_receipt.snapshot_sha256 = "0".repeat(64); },
      "packet2_import_snapshot_receipt_mismatch"],
    ["packet hash", packet => { packet.transport_receipt.packet2_hash = "0".repeat(64); },
      "packet2_import_hash_receipt_mismatch"],
    ["source match", packet => { packet.source_match.version = "server-exact-source-match-v0"; },
      "packet2_import_source_match_invalid"],
    ["service evidence", packet => { packet.service_evidence[0].verification_status = "inferred"; },
      "packet2_import_service_evidence_invalid"],
  ];
  for (const [name, mutate, expected] of cases) {
    global.fetch = async (url, init) => {
      assert.equal(url, "http://host.docker.internal:18900/api/intake-genie-import-packet2");
      const packet = importedPacket(JSON.parse(init.body).request);
      mutate(packet);
      return response(200, packet);
    };
    const result = await callIntakeGenie(prospect, { packet2Import: snapshot });
    assert.equal(result.ok, false, name);
    assert.equal(result.status, "invalid_import_response", name);
    assert.equal(result.error, expected, name);
  }
});

test("Packet2 import 422 and 503 remain refusals and never fall back to ordinary compile", async t => {
  const beforeFetch = global.fetch;
  withEnv(t, {
    INTAKE_GENIE_BASE_URL: "http://wss-local-compiler:8787",
    PACKET2_IMPORT_BASE_URL: "http://host.docker.internal:18900",
    INTAKE_GENIE_TOKEN: "test-only-token",
  });
  t.after(() => { global.fetch = beforeFetch; });
  const calls = [];
  for (const [status, error] of [[422, "visitor_files_unsafe"], [503, "fresh_harvest_unavailable"]]) {
    global.fetch = async url => {
      calls.push(url);
      return response(status, { ok: false, error });
    };
    const result = await callIntakeGenie(prospect, { packet2Import: snapshot,
      buildPreview: false, dryRun: true });
    assert.equal(result.ok, false);
    assert.equal(result.status, status);
    assert.match(result.error, new RegExp(error));
    assert.equal(calls.at(-1), "http://host.docker.internal:18900/api/intake-genie-import-packet2");
  }
  assert.equal(calls.length, 2);
});

test("WSS receipt signs exact imported Packet2, transport receipt, and visitor bytes", () => {
  const request = prospectRequest(prospect, { buildPreview: false, dryRun: true });
  const packet = importedPacket(request);
  const options = { signingKey: "test-only-content-key", requestId: request.request_id,
    jobId: packet.job_id, idempotencyKey: request.request_id,
    requestSources: { website_url: prospect.website } };
  const made = createContentCertification(packet, prospect, options);
  assert.equal(made.ok, true, JSON.stringify(made));
  const verify = candidate => verifyContentCertification(made.receipt, candidate, prospect, {
    signingKey: options.signingKey, idempotencyKey: options.idempotencyKey,
    requestSources: options.requestSources,
  });
  assert.equal(verify(packet).ok, true);
  for (const change of [
    candidate => { candidate.transport_receipt.snapshot_sha256 = "0".repeat(64); },
    candidate => { candidate.packet2_hash = "0".repeat(64); },
    candidate => { candidate.packet2.compiled.contentContract.visitor_copy.files[serviceFile] += " Altered"; },
    candidate => { candidate.content.content_files[serviceFile] += " Altered"; },
  ]) {
    const candidate = structuredClone(packet);
    change(candidate);
    assert.equal(verify(candidate).reason, "receipt_packet_mismatch");
  }
});

test("PageHub Packet2 aggregate review cannot be certified despite safe visitor hashes", () => {
  const request = prospectRequest(prospect, { buildPreview: false, dryRun: true });
  const packet = importedPacket(request);
  const quality = structuredClone(packet.content.content_quality);
  quality.status = "review";
  quality.passCount = 0;
  quality.reviewCount = 1;
  quality.visitor.passCount = 0;
  quality.visitor.reviewCount = 1;
  quality.visitor.files[0].status = "review";
  quality.visitor.files[0].reasons = ["machine_fragment_withheld"];
  packet.content.content_quality = quality;
  packet.packet2.compiled.contentQuality = quality;
  const result = createContentCertification(packet, prospect, {
    signingKey: "test-only-content-key", requestId: request.request_id,
    jobId: packet.job_id, idempotencyKey: request.request_id,
    requestSources: { website_url: prospect.website },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ["pagehub_visitor_quality_not_passed"]);
});
