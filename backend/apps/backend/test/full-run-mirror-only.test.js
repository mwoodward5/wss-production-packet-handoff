"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPreviewForProspect,
  legacySiteForgePendingResume,
} = require("../lib/full-run");
const { outreachBuildQuality } = require("../lib/email");
const {
  CANONICAL_SITEFORGE_BUILD_URL,
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("../lib/siteforge");
const { signEvidence } = require("../lib/mirror-engine/engine");

const CONSENT = Object.freeze({
  status: "granted",
  recorded_at: "2026-08-14T12:00:00.000Z",
  source: "test_fixture",
});
function truthPacket() {
  const evidence = [{
    field: "services",
    value: ["Drain cleaning"],
    source_type: "website",
    source_url: "https://acme-plumbing.example/services",
    confidence: 0.95,
  }];
  return {
    meta: { source: "intake_genie", bounded: true },
    services: ["Drain cleaning"],
    photos: ["https://acme-plumbing.example/truck.webp"],
    localSearchPlan: { citations: evidence },
    intakeGenie: {
      status: "complete",
      facts: { category: "plumbing", services: ["Drain cleaning"] },
      evidence,
      assets: [
        {
          kind: "logo",
          url: "https://acme-plumbing.example/logo.svg",
          source: "website",
          origin: "source-intake",
          approved: true,
        },
        {
          kind: "photo",
          url: "https://acme-plumbing.example/truck.webp",
          source: "website",
          origin: "source-intake",
          approved: true,
        },
      ],
    },
  };
}

function baseProspect(id = "mirror-only-acme") {
  return {
    prospect_id: id,
    business_name: "Acme Plumbing",
    industry: "plumbing",
    city: "Irvine",
    state: "CA",
    current_website: "https://acme-plumbing.example/",
    email: "owner@acme-plumbing.example",
    services: ["Drain cleaning"],
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    truth_packet_source: "intake_genie",
    truth_packet: truthPacket(),
    record: { preview_build_consent: { ...CONSENT } },
  };
}

function durableRow(prospect) {
  return {
    ...structuredClone(prospect),
    prospect_id: prospect.prospect_id,
    status: prospect.status || "new",
    record: {
      ...(prospect.record ? structuredClone(prospect.record) : {}),
      prospect_id: prospect.prospect_id,
      status: prospect.status || "new",
      preview_build_consent: { ...CONSENT },
    },
  };
}

function signedMirrorManifest({
  slug = "acme-plumbing-irvine",
  previewUrl = "https://acme-plumbing-irvine.wss-ai.com/",
  dryRun = false,
} = {}) {
  const manifest = {
    ok: true,
    dry_run: dryRun,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: "a".repeat(64),
    donor: "plumbing-premium-donor",
    donor_content_hash: "b".repeat(64),
    slug,
    ...(dryRun ? {} : {
      deploy_id: "dpl_mirror_only",
      deploy_url: "https://mirror-only-deploy.vercel.app/",
      preview_url: previewUrl,
    }),
    checks: dryRun
      ? { render: { status: "skipped_dry_run" } }
      : { render: { status: "passed" }, route_render: { status: "passed" } },
    revealable: !dryRun,
  };
  manifest.evidence_sha = signEvidence(manifest);
  return manifest;
}

function harness(prospect, options = {}) {
  let persisted = null;
  return {
    get persisted() { return persisted; },
    options: {
      ...options,
      select: async () => ({ ok: true, mode: "test_fixture", data: [durableRow(prospect)] }),
      conditionalUpdate: async (_table, _idColumn, id, _guards, patch) => {
        persisted = { prospect_id: id, ...structuredClone(patch) };
        return {
          ok: true,
          mode: "live_update",
          updated: true,
          rows: [structuredClone(persisted)],
        };
      },
      upsertRow: async () => {
        throw new Error("a final Mirror result must never use an unconditional upsert");
      },
    },
  };
}

test("fresh preview uses Mirror only and preserves its signed evidence through persistence and outreach", async () => {
  const prospect = baseProspect();
  const oldDispatch = {
    mode: "forge_job_mirror",
    ready: true,
    pending: false,
    renderer: "ghost-forge-mirror-v1",
    preview_url: "https://old-forge-alias.wss-ai.com/",
  };
  prospect.preview_url = oldDispatch.preview_url;
  prospect.record = {
    ...prospect.record,
    build_dispatch: oldDispatch,
    forge_job: {
      stage: "done",
      deploy: { alias: oldDispatch.preview_url },
      audit: { verdict: "PASS" },
    },
  };

  const manifest = signedMirrorManifest();
  let mirrorOptions = null;
  let siteForgeCalls = 0;
  const h = harness(prospect, {
    source: "admin_build_preview",
    operationKey: "line:batch-17:row-3:mirror",
    dispatchSiteForgePreview: async () => {
      siteForgeCalls += 1;
      throw new Error("fresh SiteForge must be unreachable");
    },
    buildMirrorForProspect: async (_input, options) => {
      mirrorOptions = options;
      return {
        ok: true,
        revealable: true,
        preview_url: manifest.preview_url,
        slug: manifest.slug,
        donor: manifest.donor,
        vertical: "plumbing",
        photoCount: 4,
        contentCoverage: { services: 1, reviews: 0, hours: 0 },
        build_hash: manifest.build_hash,
        renderer: manifest.renderer,
        qc_contract: manifest.qc_contract,
        evidence_schema: manifest.evidence_schema,
        evidence_sha: manifest.evidence_sha,
        release_evidence: manifest,
      };
    },
  });

  const result = await buildPreviewForProspect(prospect, h.options);
  assert.equal(result.ok, true);
  assert.equal(result.preview_url, manifest.preview_url);
  assert.notEqual(result.preview_url, oldDispatch.preview_url);
  assert.equal(result.renderer, MIRROR_ENGINE_RENDERER);
  assert.equal(result.required_renderer, MIRROR_ENGINE_RENDERER);
  assert.equal(result.required_qc_contract, MIRROR_ENGINE_QC_CONTRACT);
  assert.equal(result.siteforge_dispatched, false);
  assert.equal(siteForgeCalls, 0);
  assert.equal(mirrorOptions.operationKey, "line:batch-17:row-3:mirror");

  assert.deepEqual(h.persisted.record.build_dispatch.release_evidence, manifest);
  assert.deepEqual(h.persisted.record.release_evidence, manifest);
  assert.deepEqual(h.persisted.record.legacy_build_dispatch, oldDispatch);
  assert.equal(h.persisted.record.forge_job.deploy.alias, oldDispatch.preview_url);

  const quality = outreachBuildQuality(h.persisted);
  assert.equal(quality.ok, true, quality.reasons.join(","));
  assert.equal(quality.renderer, MIRROR_ENGINE_RENDERER);
  assert.equal(quality.releaseEvidencePassed, true);
});

test("Mirror refusal and forceFreshDispatch cannot escape to SiteForge or a completed Forge alias", async () => {
  const prospect = baseProspect("mirror-refusal");
  prospect.preview_url = "https://completed-forge.wss-ai.com/";
  prospect.record = {
    ...prospect.record,
    forge_job: { stage: "done", deploy: { alias: prospect.preview_url } },
  };
  let siteForgeCalls = 0;
  const h = harness(prospect, {
    source: "admin_build_preview",
    forceFreshDispatch: true,
    dispatchSiteForgePreview: async () => {
      siteForgeCalls += 1;
      return { mode: "http_dispatch", pending: true };
    },
    buildMirrorForProspect: async () => ({ ok: false, reason: "client_logo_unverified" }),
  });

  const result = await buildPreviewForProspect(prospect, h.options);
  assert.equal(result.ok, false);
  assert.equal(result.pending, false);
  assert.equal(result.status, "held");
  assert.equal(result.preview_url, null, "an older alias is not proof of this failed build");
  assert.equal(result.blocked, "client_logo_unverified");
  assert.equal(result.renderer, MIRROR_ENGINE_RENDERER);
  assert.equal(result.siteforge_dispatched, false);
  assert.equal(siteForgeCalls, 0);
  assert.equal(h.persisted.record.forge_job.deploy.alias, prospect.preview_url, "legacy record remains readable");
  assert.equal(h.persisted.record.build_dispatch.ready, false);
});

test("only the reconciler can drain an exact persisted legacy pending SiteForge job", async () => {
  const prospect = baseProspect("legacy-pending-1");
  const jobId = "siteforge-job-42";
  const statusUrl = `${CANONICAL_SITEFORGE_BUILD_URL}/${jobId}`;
  prospect.record = {
    ...prospect.record,
    prospect_id: prospect.prospect_id,
    status: "new",
    blocked_reason: "siteforge_build_pending",
    build_dispatch: {
      mode: "http_dispatch",
      ready: false,
      pending: true,
      job_id: jobId,
      status_url: statusUrl,
    },
  };
  let mirrorCalls = 0;
  let readerCalls = 0;
  const h = harness(prospect, {
    source: "siteforge_reconcile",
    buildMirrorForProspect: async () => {
      mirrorCalls += 1;
      throw new Error("legacy drain must not start a fresh Mirror build");
    },
    dispatchSiteForgePreview: async ({ resume }) => {
      readerCalls += 1;
      assert.deepEqual(resume, { job_id: jobId, status_url: statusUrl });
      return {
        mode: "existing_job_status_read",
        configured: true,
        pending: true,
        jobId,
        statusUrl,
        urls: {},
        buildStatus: {
          ready: false,
          pending: true,
          renderer: "05-build-v8",
          required_renderer: "05-build-v8",
          qc_passed: false,
          visual_qc_passed: false,
          blocked: [],
        },
      };
    },
  });

  const result = await buildPreviewForProspect(prospect, h.options);
  assert.equal(readerCalls, 1);
  assert.equal(mirrorCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.pending, true);
  assert.equal(result.status, "new");
  assert.equal(result.blocked, "siteforge_build_pending");
  assert.equal(result.legacy_siteforge_drained, true);
  assert.equal(result.siteforge_dispatched, false);
});

test("legacy resume validation rejects request-only, completed, mismatched, and noncanonical handles", () => {
  const prospect = durableRow(baseProspect("legacy-validator"));
  const record = prospect.record;
  const jobId = "job-safe-1";
  record.blocked_reason = "siteforge_build_pending";
  record.build_dispatch = {
    mode: "http_dispatch",
    ready: false,
    pending: true,
    job_id: jobId,
    status_url: `${CANONICAL_SITEFORGE_BUILD_URL}/${jobId}`,
  };
  assert.deepEqual(
    legacySiteForgePendingResume(prospect, prospect.prospect_id),
    { job_id: jobId, status_url: `${CANONICAL_SITEFORGE_BUILD_URL}/${jobId}` },
  );

  for (const mutate of [
    (row) => { row.record.build_dispatch.pending = false; },
    (row) => { row.record.build_dispatch.ready = true; },
    (row) => { row.record.build_dispatch.job_id = "other-job"; },
    (row) => { row.record.build_dispatch.status_url = "https://evil.example/jobs/job-safe-1"; },
    (row) => { row.record.blocked_reason = ""; },
  ]) {
    const invalid = structuredClone(prospect);
    mutate(invalid);
    assert.equal(legacySiteForgePendingResume(invalid, prospect.prospect_id), null);
  }
});
