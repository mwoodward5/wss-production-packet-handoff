"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { compileGenieContent } = require("../lib/line-adapters");
const { callIntakeGenie } = require("../lib/intake-genie-client");

const KEY = "test-only-packet2-line-certification-key";
const SOURCE = "https://acme-plumbing.example/services";
const SNAPSHOT = Buffer.from(JSON.stringify({ version: "2.0", fixture: true })).toString("base64");
const SNAPSHOT_SHA = createHash("sha256")
  .update(Buffer.from(SNAPSHOT, "base64"))
  .digest("hex");
const PACKET2_HASH = "a".repeat(64);
const IMPORT = Object.freeze({
  snapshot_base64: SNAPSHOT,
  snapshot_sha256: SNAPSHOT_SHA,
});

function visitorContract() {
  const files = {
    "content/home.md": "# Acme Plumbing\n\nSource-backed plumbing service in Reno.",
    "content/services/drain-cleaning.md": "# Drain Cleaning\n\nDrain cleaning service in Reno.",
  };
  return {
    schema: "CertifiedPracticePacket/v1",
    kind: "certified_practice_packet",
    version: 1,
    facts: { category: "plumbing" },
    assets: {},
    builder_instructions: { public: false },
    visitor_copy: {
      kind: "visitor_copy",
      files,
      file_hashes: Object.fromEntries(Object.entries(files).map(([name, body]) => [
        name, createHash("sha256").update(body).digest("hex"),
      ])),
      safety: { pass: true, violations: [] },
    },
  };
}

function packet(overrides = {}) {
  return {
    ok: true,
    version: "intake-genie-v2",
    status: "compiled",
    scope: { supported: true, category: "plumbing" },
    job_id: "pagehub:" + PACKET2_HASH.slice(0, 24),
    request_id: "ghost:acme-1:line-genie-certified-v7",
    packet2_hash: PACKET2_HASH,
    transport_receipt: {
      version: "owner-packet2-import-v1",
      snapshot_sha256: SNAPSHOT_SHA,
      packet2_hash: PACKET2_HASH,
    },
    facts: {
      name: "Acme Plumbing",
      city: "Reno",
      state: "NV",
      category: "plumbing",
      services_source: "source_observation",
      services: ["Drain Cleaning"],
    },
    service_evidence: [{
      field: "services",
      value: "Drain Cleaning",
      source_url: SOURCE,
      source_observations: [SOURCE],
      provenance: "observed",
      verification_status: "source_observation",
    }],
    evidence: [{
      field: "services",
      value: "Drain Cleaning",
      source_url: SOURCE,
      source_observations: [SOURCE],
      provenance: "observed",
      verification_status: "source_observation",
    }],
    packet2: {
      sources: { observations: [{
        source: SOURCE,
        extracted: {
          exactServices: "Drain Cleaning",
          mainServices: "Drain Cleaning",
        },
      }] },
    },
    content: {
      services: [{ name: "Drain Cleaning", providerName: "Acme Plumbing" }],
      content_contract: visitorContract(),
    },
    ...overrides,
  };
}

function row() {
  return {
    prospect_id: "acme-1",
    business_name: "Acme Plumbing",
    city: "Reno",
    state: "NV",
    place_id: "ChIJ-acme",
    website: "https://acme-plumbing.example",
    industry: "plumbing",
    status: "held",
    updated_at: "2026-09-28T20:00:00.000Z",
    record: {
      business_name: "Acme Plumbing",
      city: "Reno",
      state: "NV",
      place_id: "ChIJ-acme",
      website: "https://acme-plumbing.example",
      industry: "plumbing",
      status: "held",
    },
  };
}

function compilerResult(current = packet()) {
  return {
    ok: true,
    packet: current,
    request: {
      request_id: "ghost:acme-1:line-genie-certified-v7",
      sources: { website_url: SOURCE },
    },
    idempotencyKey: "ghost:acme-1:line-genie-certified-v7",
  };
}

function deps(overrides = {}) {
  return {
    env: { VERCEL_ENV: "production" },
    certificationKey: KEY,
    now: () => "2026-09-28T20:05:00.000Z",
    nowMs: Date.parse("2026-09-28T20:06:00.000Z"),
    conditionalUpdate: async () => ({ ok: true, updated: true }),
    ...overrides,
  };
}

test("explicit Packet2 import is forwarded and certified through the existing persistence path", async () => {
  let seenOptions;
  let saved;
  const result = await compileGenieContent(row(), deps({
    packet2Import: IMPORT,
    callIntakeGenie: async (_prospect, options) => {
      seenOptions = options;
      return compilerResult();
    },
    conditionalUpdate: async (_table, _key, _id, _guards, patch) => {
      saved = patch.record;
      return { ok: true, updated: true };
    },
  }));

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.certified, true);
  assert.equal(result.reused, false);
  assert.deepEqual(seenOptions.packet2Import, IMPORT);
  assert.equal(saved.genie_canonical_packet.packet2_hash, PACKET2_HASH);
  assert.equal(saved.genie_canonical_packet.transport_receipt.snapshot_sha256, SNAPSHOT_SHA);
  assert.equal(saved.genie_content_certification.evidence.source_bound, true);
  assert.equal(saved.genie_content_certification.evidence.service_count, 2);
});

test("Packet2 refusal fails closed with one import call and no persistence", async () => {
  let calls = 0;
  let writes = 0;
  const result = await compileGenieContent(row(), deps({
    packet2Import: IMPORT,
    callIntakeGenie: async (_prospect, options) => {
      calls += 1;
      assert.deepEqual(options.packet2Import, IMPORT);
      return { ok: false, status: 422, error: "service_provenance_unverified" };
    },
    conditionalUpdate: async () => {
      writes += 1;
      return { ok: true, updated: true };
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.equal(result.candidateLocal, true);
  assert.equal(result.reason, "service_provenance_unverified");
  assert.equal(calls, 1);
  assert.equal(writes, 0);
});

test("Packet2 transport receipt must bind both snapshot and returned Packet2 hash", async () => {
  let writes = 0;
  const bad = packet({
    transport_receipt: {
      version: "owner-packet2-import-v1",
      snapshot_sha256: "b".repeat(64),
      packet2_hash: PACKET2_HASH,
    },
  });
  const result = await compileGenieContent(row(), deps({
    packet2Import: IMPORT,
    callIntakeGenie: async () => compilerResult(bad),
    conditionalUpdate: async () => {
      writes += 1;
      return { ok: true, updated: true };
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, "packet2_import_transport_mismatch");
  assert.equal(writes, 0);
});

test("Packet2 uses the existing certification admission instead of a second service policy", async () => {
  const unbound = packet({
    evidence: [],
    service_evidence: [],
  });
  const result = await compileGenieContent(row(), deps({
    packet2Import: IMPORT,
    callIntakeGenie: async () => compilerResult(unbound),
  }));

  assert.equal(result.ok, false);
  assert.match(result.reason, /^intake_genie_certification_failed:/);
  assert.equal(result.reason.includes("packet2_import_source_services_required"), false);
});
test("normal compile calls remain unchanged and receive no Packet2 option", async () => {
  let seenOptions;
  const normal = packet();
  delete normal.transport_receipt;
  const result = await compileGenieContent(row(), deps({
    callIntakeGenie: async (_prospect, options) => {
      seenOptions = options;
      return compilerResult(normal);
    },
  }));

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(Object.prototype.hasOwnProperty.call(seenOptions, "packet2Import"), false);
});

test("Packet2 snapshot bytes must match the supplied snapshot hash before compiler spend", async () => {
  let calls = 0;
  const result = await compileGenieContent(row(), deps({
    packet2Import: { ...IMPORT, snapshot_sha256: "c".repeat(64) },
    callIntakeGenie: async () => {
      calls += 1;
      return compilerResult();
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, "packet2_import_snapshot_invalid");
  assert.equal(calls, 0);
});

test("explicit Packet2 import refuses when certified admission is disabled", async () => {
  let calls = 0;
  const result = await compileGenieContent(row(), deps({
    env: { GHOST_AGENCY_GENIE_CERTIFIED_ADMISSION: "0" },
    packet2Import: IMPORT,
    callIntakeGenie: async () => {
      calls += 1;
      return compilerResult();
    },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "packet2_certification_disabled");
  assert.equal(calls, 0);
});

test("direct template selection changes request and HTTP idempotency while Packet2 import stays saved", async (t) => {
  const previous = Object.fromEntries(["INTAKE_GENIE_BASE_URL", "PACKET2_IMPORT_BASE_URL",
    "INTAKE_GENIE_TOKEN", "INTAKE_GENIE_TEMPLATE_ID"].map((key) => [key, process.env[key]]));
  const previousFetch = global.fetch;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    global.fetch = previousFetch;
  });
  process.env.INTAKE_GENIE_BASE_URL = "https://direct.example";
  process.env.PACKET2_IMPORT_BASE_URL = "https://import.example";
  process.env.INTAKE_GENIE_TOKEN = "test-only-token";
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), idempotency: init.headers["Idempotency-Key"] });
    return { ok: false, status: 422, text: async () => JSON.stringify({ ok: false, error: "test_stop_after_capture" }) };
  };
  const prospect = row();
  delete process.env.INTAKE_GENIE_TEMPLATE_ID;
  await callIntakeGenie(prospect, { pipelineVersion: "line-genie-certified-v7", dryRun: true });
  process.env.INTAKE_GENIE_TEMPLATE_ID = "single-cinematic-motion";
  await callIntakeGenie(prospect, { pipelineVersion: "line-genie-certified-v7", dryRun: true });
  await callIntakeGenie(prospect, { pipelineVersion: "line-genie-certified-v7", dryRun: true, packet2Import: IMPORT });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body.selectedTemplateId, undefined);
  assert.equal(calls[0].body.request_id, "ghost:acme-1:line-genie-certified-v7");
  assert.equal(calls[0].idempotency, calls[0].body.request_id);
  assert.equal(calls[1].body.selectedTemplateId, "single-cinematic-motion");
  assert.equal(calls[1].body.request_id, "ghost:acme-1:template:single-cinematic-motion:line-genie-certified-v7");
  assert.equal(calls[1].idempotency, calls[1].body.request_id);
  assert.equal(calls[1].url, "https://direct.example/api/intake-genie/compile");
  assert.equal(calls[2].url, "https://import.example/api/intake-genie-import-packet2");
  assert.equal(calls[2].body.request.selectedTemplateId, undefined);
  assert.equal(calls[2].body.request.request_id, calls[0].body.request_id);
});

test("switching direct template invalidates a signed cached default receipt", async () => {
  let saved;
  const ordinary = packet();
  delete ordinary.transport_receipt;
  const first = await compileGenieContent(row(), deps({
    callIntakeGenie: async () => compilerResult(ordinary),
    conditionalUpdate: async (_table, _key, _id, _guards, patch) => {
      saved = patch.record;
      return { ok: true, updated: true };
    },
  }));
  assert.equal(first.ok, true, JSON.stringify(first));
  let recompiles = 0;
  const selected = await compileGenieContent({ ...row(), record: saved }, deps({
    env: { VERCEL_ENV: "production", INTAKE_GENIE_TEMPLATE_ID: "single-cinematic-motion" },
    callIntakeGenie: async () => {
      recompiles += 1;
      return { ok: false, status: 422, error: "test_stop_after_capture" };
    },
  }));
  assert.equal(selected.ok, false);
  assert.equal(selected.reason, "test_stop_after_capture");
  assert.equal(recompiles, 1, "a signed default receipt must not bypass the selected template compile");
});

test("selected template receipt reuses only while its direct template stays selected", async () => {
  const templateId = "single-cinematic-motion";
  const requestId = `ghost:acme-1:template:${templateId}:line-genie-certified-v7`;
  const selectedPacket = packet({
    request_id: requestId,
    packet2: { ...packet().packet2, selectedTemplateId: templateId },
  });
  delete selectedPacket.transport_receipt;
  let saved;
  const selectedDeps = {
    env: { VERCEL_ENV: "production", INTAKE_GENIE_TEMPLATE_ID: templateId },
  };
  const first = await compileGenieContent(row(), deps({
    ...selectedDeps,
    callIntakeGenie: async () => ({
      ok: true, packet: selectedPacket,
      request: { request_id: requestId, sources: { website_url: SOURCE } },
      idempotencyKey: requestId,
    }),
    conditionalUpdate: async (_table, _key, _id, _guards, patch) => {
      saved = patch.record;
      return { ok: true, updated: true };
    },
  }));
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(saved.genie_content_certification_contract.selected_template_id, templateId);
  const persisted = { ...row(), record: saved };
  const reused = await compileGenieContent(persisted, deps({
    ...selectedDeps,
    callIntakeGenie: async () => { throw new Error("must reuse selected template"); },
  }));
  assert.equal(reused.ok, true);
  assert.equal(reused.reused, true);
  let recompiles = 0;
  const switchedOff = await compileGenieContent(persisted, deps({
    callIntakeGenie: async () => {
      recompiles += 1;
      return { ok: false, status: 422, error: "test_stop_after_capture" };
    },
  }));
  assert.equal(switchedOff.ok, false);
  assert.equal(recompiles, 1);
});
