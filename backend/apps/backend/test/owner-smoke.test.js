"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { afterEach, beforeEach, test } = require("node:test");
const { OWNER_EMAIL } = require("../scripts/supervised-five-owner-smoke");
const ownerSmokeRoute = require("../api/admin/owner-smoke");

const { SEND_CONFIRMATION, createOwnerSmokeHandler } = ownerSmokeRoute;
const ADMIN_TOKEN = "native-owner-smoke-test-token";
const ENV_KEYS = [
  "GHOST_AGENCY_ADMIN_TOKEN",
  "GHOST_AGENCY_ADMIN_TOKEN_SECONDARY",
  "GHOST_AGENCY_ADMIN_TOKEN_SECONDARY_EXPIRES_AT",
  "GHOST_AGENCY_ORGANIC_EMAIL",
  "GHOST_AGENCY_OUTREACH_CC",
  "GHOST_AGENCY_OWNER_EMAIL",
];
let savedEnv;

function mockRes() {
  return {
    headers: {},
    statusCode: 0,
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value; },
  };
}

function json(res) {
  return JSON.parse(res.body || "{}");
}

function adminHeaders() {
  return { "x-admin-token": ADMIN_TOKEN };
}

function persistedProspect(overrides = {}) {
  const recordOverrides = overrides.record || {};
  return {
    prospect_id: "persisted-owner-smoke-1",
    status: "previewed",
    business_name: "Persisted Roofing Co",
    email: "real-prospect@roofing-business.test",
    owner_email: "real-prospect@roofing-business.test",
    place_id: "places-owner-smoke-1",
    source: "places-live-mine",
    industry: "roofing",
    city: "Irvine",
    services: ["Roof repair"],
    preview_url: "https://previews.wss-ai.com/persisted-owner-smoke-1",
    report_url: "https://reports.wss-ai.com/persisted-owner-smoke-1",
    record: {
      prospect_id: "persisted-owner-smoke-1",
      business_name: "Persisted Roofing Co",
      email: "real-prospect@roofing-business.test",
      owner_email: "real-prospect@roofing-business.test",
      place_id: "places-owner-smoke-1",
      source: "places-live-mine",
      siteforge_renderer: "05-build-v8",
      siteforge_generation_fingerprint: "composition-owner-smoke-v8",
      siteforge_qc_passed: true,
      siteforge_visual_qc_passed: true,
      siteforge_qc_contract: "public-surface-v2",
      release_evidence: {
        schema: "siteforge-release-evidence-v1",
        map: { verified: true },
        identity: { verified: true },
        template_family: { verified: true },
      },
      ...recordOverrides,
    },
    ...overrides,
    record: {
      prospect_id: "persisted-owner-smoke-1",
      business_name: "Persisted Roofing Co",
      email: "real-prospect@roofing-business.test",
      owner_email: "real-prospect@roofing-business.test",
      place_id: "places-owner-smoke-1",
      source: "places-live-mine",
      siteforge_renderer: "05-build-v8",
      siteforge_generation_fingerprint: "composition-owner-smoke-v8",
      siteforge_qc_passed: true,
      siteforge_visual_qc_passed: true,
      siteforge_qc_contract: "public-surface-v2",
      ...recordOverrides,
    },
  };
}

function unbuiltProspect() {
  return persistedProspect({
    status: "new",
    preview_url: null,
    report_url: null,
    record: {
      siteforge_renderer: null,
      siteforge_generation_fingerprint: null,
      siteforge_qc_passed: false,
      siteforge_visual_qc_passed: false,
      siteforge_qc_contract: null,
    },
  });
}

function successfulFetch(url) {
  return Promise.resolve({
    ok: true,
    status: 200,
    url,
    headers: { get: () => "text/html; charset=utf-8" },
    body: { cancel: async () => {} },
  });
}

function passingReplacementBuild(prospectId = "persisted-owner-smoke-1") {
  return {
    ok: true,
    prospect_id: prospectId,
    status: "previewed",
    renderer: "05-build-v8",
    generation_fingerprint: "composition-replacement-v8",
    qc_passed: true,
    visual_qc_passed: true,
    qc_contract: "public-surface-v2",
    release_evidence: {
      schema: "siteforge-release-evidence-v1",
      map: { verified: true },
      identity: { verified: true },
      template_family: { verified: true },
    },
    preview_url: `https://previews.wss-ai.com/${prospectId}-replacement`,
    report_url: `https://reports.wss-ai.com/${prospectId}-replacement`,
  };
}

function persistReplacementBuild(row, build) {
  row.status = build.status;
  row.preview_url = build.preview_url;
  row.report_url = build.report_url;
  row.record = {
    ...row.record,
    status: build.status,
    preview_url: build.preview_url,
    report_url: build.report_url,
    siteforge_renderer: build.renderer,
    siteforge_generation_fingerprint: build.generation_fingerprint,
    siteforge_qc_passed: build.qc_passed,
    siteforge_visual_qc_passed: build.visual_qc_passed,
    siteforge_qc_contract: build.qc_contract,
    release_evidence: build.release_evidence,
  };
  return build;
}

function testHandler({ row = persistedProspect(), calls, ...overrides } = {}) {
  const stagedBody = "Owner smoke preview body";
  const stagedHtml = "<!doctype html><html><body>Owner smoke preview</body></html>";
  const stagedDraft = {
    draft_id: "staged-owner-smoke-draft-1",
    hold_key: "supervised_10_review_pending",
    prospect_id: "persisted-owner-smoke-1",
    recipient_email: "real-prospect@roofing-business.test",
    preview_url: "https://previews.wss-ai.com/persisted-owner-smoke-1",
    getfound_grade: "C",
    subject: "Owner smoke preview",
    body: stagedBody,
    compose_mode: "dry_run",
    delivery_status: "review_only",
    approval_status: "awaiting_explicit_later_approval",
  };
  const stagedAudit = {
    payload: {
      html_sha256: createHash("sha256").update(stagedHtml).digest("hex"),
    },
  };
  return createOwnerSmokeHandler({
    now: () => 1_700_000_000_000,
    select: async (table, query) => {
      calls.select.push({ table, query });
      return { ok: true, data: [row] };
    },
    fetch: async (url) => {
      calls.fetch.push(url);
      return successfulFetch(url);
    },
    buildPreviewForProspect: async () => {
      throw new Error("A persisted QC-ready build should be reused.");
    },
    claimOwnerDelivery: async () => ({ mode: "live_write" }),
    verifyStagedTenMembership: async ({ prospect }) => ({
      ok: true,
      draft: { ...stagedDraft, prospect_id: prospect.prospect_id },
    }),
    loadStagedArtifactBinding: async ({ membership }) => ({
      ok: true,
      draft: membership.draft,
      audit: stagedAudit,
    }),
    sendSequenceStep: async (input) => {
      calls.email.push(input);
      assert.equal(process.env.GHOST_AGENCY_OUTREACH_CC, "");
      assert.equal(process.env.GHOST_AGENCY_OWNER_EMAIL, OWNER_EMAIL);
      assert.equal(process.env.GHOST_AGENCY_ORGANIC_EMAIL, "off");
      assert.equal(input.persistCampaignLog, false);
      return input.dryRun
        ? {
            ok: true,
            mode: "dry_run",
            cc: [],
            subject: "Owner smoke preview",
            bodyPreview: stagedBody,
            htmlPreview: stagedHtml,
          }
        : { ok: true, mode: "sent", id: "fake-owner-send" };
    },
    ...overrides,
  });
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.GHOST_AGENCY_ADMIN_TOKEN = ADMIN_TOKEN;
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY;
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY_EXPIRES_AT;
  process.env.GHOST_AGENCY_OUTREACH_CC = OWNER_EMAIL;
  process.env.GHOST_AGENCY_OWNER_EMAIL = OWNER_EMAIL;
  process.env.GHOST_AGENCY_ORGANIC_EMAIL = "on";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test("route requires native admin auth before reading persisted prospects", async () => {
  const calls = { select: [], fetch: [], email: [] };
  const handler = testHandler({ calls });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: {},
    body: { prospectId: "persisted-owner-smoke-1" },
  }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(json(res).error, "unauthorized");
  assert.equal(calls.select.length, 0);
  assert.equal(calls.email.length, 0);
});

test("compose is default and only owner contact fields reach the email path", async () => {
  const calls = { select: [], fetch: [], email: [] };
  const handler = testHandler({ calls });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: {
      prospectId: "persisted-owner-smoke-1",
      to: "attacker@example.test",
      cc: ["attacker@example.test"],
    },
  }, res);

  assert.equal(res.statusCode, 200);
  const body = json(res);
  assert.equal(body.status, "composed");
  assert.equal(body.action, "compose");
  assert.equal(body.build.renderer, "05-build-v8");
  assert.equal(body.build.generation_fingerprint, "composition-owner-smoke-v8");
  assert.deepEqual(body.delivery, { to: OWNER_EMAIL, cc: [], bcc: [] });
  assert.match(body.email.html, /Owner smoke preview/);
  assert.equal(calls.select.length, 1);
  assert.equal(calls.fetch.length, 2);
  assert.equal(calls.email.length, 1);
  assert.equal(calls.email[0].dryRun, true);
  assert.equal(calls.email[0].prospect.email, OWNER_EMAIL);
  assert.equal(calls.email[0].prospect.owner_email, OWNER_EMAIL);
  assert.equal(calls.email[0].prospect.record.email, OWNER_EMAIL);
  assert.equal(calls.email[0].prospect.business_name, "Persisted Roofing Co");
  assert.equal(process.env.GHOST_AGENCY_OUTREACH_CC, OWNER_EMAIL);
  assert.equal(process.env.GHOST_AGENCY_OWNER_EMAIL, OWNER_EMAIL);
  assert.equal(process.env.GHOST_AGENCY_ORGANIC_EMAIL, "on");
});

for (const action of ["compose", "send"]) {
  test(`${action} fails closed before any email path or claim when staged-10 membership is not exact`, async () => {
    const calls = { select: [], fetch: [], email: [], build: [] };
    let membershipCalls = 0;
    let ownerPathCalls = 0;
    let claimCalls = 0;
    const handler = testHandler({
      calls,
      verifyStagedTenMembership: async ({ prospect, nowMs }) => {
        membershipCalls += 1;
        assert.equal(prospect.prospect_id, "persisted-owner-smoke-1");
        assert.equal(nowMs, 1_700_000_000_000);
        return { ok: false, reason: "staged_ten_draft_not_in_active_batch" };
      },
      invokeOwnerEmailPath: async () => {
        ownerPathCalls += 1;
        throw new Error("membership gate must run before the owner email path");
      },
      claimOwnerDelivery: async () => {
        claimCalls += 1;
        return { mode: "live_write" };
      },
      buildPreviewForProspect: async () => {
        calls.build.push("unexpected");
        throw new Error("membership gate must run before a build");
      },
    });
    const res = mockRes();
    await handler({
      method: "POST",
      headers: adminHeaders(),
      body: {
        prospectId: "persisted-owner-smoke-1",
        action,
        ...(action === "send" ? { confirmation: SEND_CONFIRMATION } : {}),
      },
    }, res);

    assert.equal(res.statusCode, 422);
    const body = json(res);
    assert.equal(body.error, "staged_ten_membership_required");
    assert.equal(body.details.reason, "staged_ten_draft_not_in_active_batch");
    assert.equal(membershipCalls, 1);
    assert.equal(ownerPathCalls, 0);
    assert.equal(claimCalls, 0);
    assert.equal(calls.fetch.length, 0);
    assert.equal(calls.email.length, 0);
    assert.equal(calls.build.length, 0);
  });
}

test("membership verifier failure is an explicit 422 and never reaches composition", async () => {
  const calls = { select: [], fetch: [], email: [] };
  let claimCalls = 0;
  const handler = testHandler({
    calls,
    verifyStagedTenMembership: async () => {
      throw new Error("durable state unavailable");
    },
    claimOwnerDelivery: async () => {
      claimCalls += 1;
      return { mode: "live_write" };
    },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1" },
  }, res);

  assert.equal(res.statusCode, 422);
  assert.equal(json(res).error, "staged_ten_membership_required");
  assert.equal(json(res).details.reason, "staged_ten_state_unavailable");
  assert.equal(claimCalls, 0);
  assert.equal(calls.fetch.length, 0);
  assert.equal(calls.email.length, 0);
});

test("compose fails closed when the exact staged artifact or its deterministic audit is missing", async () => {
  const calls = { select: [], fetch: [], email: [] };
  let ownerPathCalls = 0;
  const handler = testHandler({
    calls,
    loadStagedArtifactBinding: async () => ({ ok: false, reason: "staged_draft_audit_missing" }),
    invokeOwnerEmailPath: async () => {
      ownerPathCalls += 1;
      throw new Error("composition must not start without a durable staged artifact");
    },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1", action: "compose" },
  }, res);

  assert.equal(res.statusCode, 422);
  assert.equal(json(res).error, "staged_draft_artifact_required");
  assert.equal(json(res).details.reason, "staged_draft_audit_missing");
  assert.equal(ownerPathCalls, 0);
  assert.equal(calls.email.length, 0);
});

test("compose proves the fresh subject, body, and HTML hash match the staged artifact", async () => {
  const calls = { select: [], fetch: [], email: [] };
  let claimCalls = 0;
  const handler = testHandler({
    calls,
    loadStagedArtifactBinding: async ({ membership }) => ({
      ok: true,
      draft: { ...membership.draft, subject: "Different staged subject" },
      audit: {
        payload: {
          html_sha256: createHash("sha256").update("<!doctype html><html><body>Owner smoke preview</body></html>").digest("hex"),
        },
      },
    }),
    claimOwnerDelivery: async () => {
      claimCalls += 1;
      return { mode: "live_write" };
    },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1", action: "compose" },
  }, res);

  assert.equal(res.statusCode, 422);
  assert.equal(json(res).error, "staged_draft_artifact_mismatch");
  assert.equal(claimCalls, 0);
  assert.deepEqual(calls.email.map((call) => call.dryRun), [true]);
});

test("persisted V7 previews are rebuilt before owner-only proof composition", async () => {
  const calls = { select: [], fetch: [], email: [], build: [] };
  const row = persistedProspect({
    record: {
      siteforge_renderer: "05-build-v7",
      siteforge_generation_fingerprint: "composition-legacy-v7",
    },
  });
  const handler = testHandler({
    row,
    calls,
    buildPreviewForProspect: async (prospect, options) => {
      calls.build.push({ prospectId: prospect.prospect_id, options });
      return persistReplacementBuild(row, passingReplacementBuild(prospect.prospect_id));
    },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1" },
  }, res);

  assert.equal(res.statusCode, 202);
  const body = json(res);
  assert.equal(body.status, "build_ready_resume");
  assert.equal(body.build.renderer, "05-build-v8");
  assert.equal(body.build.generation_fingerprint, "composition-replacement-v8");
  assert.deepEqual(calls.build.map((call) => call.prospectId), ["persisted-owner-smoke-1"]);
  assert.equal(calls.build[0].options.persist, true);
  assert.equal(calls.fetch.length, 0);
  assert.equal(calls.email.length, 0);
});

test("persisted V8 previews without a fingerprint are rebuilt before reuse", async () => {
  const calls = { select: [], fetch: [], email: [], build: [] };
  const row = persistedProspect({
    record: { siteforge_generation_fingerprint: null },
  });
  const handler = testHandler({
    row,
    calls,
    buildPreviewForProspect: async (prospect, options) => {
      calls.build.push({ prospectId: prospect.prospect_id, options });
      return persistReplacementBuild(row, passingReplacementBuild(prospect.prospect_id));
    },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1" },
  }, res);

  assert.equal(res.statusCode, 202);
  const body = json(res);
  assert.equal(body.status, "build_ready_resume");
  assert.deepEqual(calls.build.map((call) => call.prospectId), ["persisted-owner-smoke-1"]);
  assert.equal(calls.build[0].options.persist, true);
  assert.equal(calls.fetch.length, 0);
  assert.equal(calls.email.length, 0);
});

test("a durable V8 rebuild advances the next owner-smoke request", async () => {
  const calls = { select: [], fetch: [], email: [], build: [] };
  const row = unbuiltProspect();
  const handler = testHandler({
    row,
    calls,
    buildPreviewForProspect: async (prospect, options) => {
      calls.build.push({ prospectId: prospect.prospect_id, options });
      return persistReplacementBuild(row, passingReplacementBuild(prospect.prospect_id));
    },
  });

  const first = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1" },
  }, first);

  assert.equal(first.statusCode, 202);
  assert.equal(json(first).status, "build_ready_resume");
  assert.equal(json(first).build.renderer, "05-build-v8");
  assert.equal(json(first).build.generation_fingerprint, "composition-replacement-v8");
  assert.equal(json(first).build.preview_url, "https://previews.wss-ai.com/persisted-owner-smoke-1-replacement");
  assert.equal(json(first).build.report_url, "https://reports.wss-ai.com/persisted-owner-smoke-1-replacement");
  assert.equal(json(first).build.qc_passed, true);
  assert.equal(json(first).build.visual_qc_passed, true);
  assert.equal(json(first).build.qc_contract, "public-surface-v2");
  assert.equal(calls.build[0].options.persist, true);
  assert.equal(calls.select.length, 2);

  const second = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1" },
  }, second);

  assert.equal(second.statusCode, 200);
  assert.equal(json(second).status, "composed");
  assert.equal(json(second).build.renderer, "05-build-v8");
  assert.equal(json(second).build.generation_fingerprint, "composition-replacement-v8");
  assert.equal(json(second).build.preview_url, "https://previews.wss-ai.com/persisted-owner-smoke-1-replacement");
  assert.equal(json(second).build.report_url, "https://reports.wss-ai.com/persisted-owner-smoke-1-replacement");
  assert.equal(calls.build.length, 1);
  assert.equal(calls.select.length, 3);
  assert.equal(calls.fetch.length, 2);
  assert.equal(calls.email.length, 1);
});

test("a locally passing rebuild fails closed when its V8 artifact was not persisted", async () => {
  const calls = { select: [], fetch: [], email: [], build: [] };
  const row = unbuiltProspect();
  const handler = testHandler({
    row,
    calls,
    buildPreviewForProspect: async (prospect, options) => {
      calls.build.push({ prospectId: prospect.prospect_id, options });
      return passingReplacementBuild(prospect.prospect_id);
    },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1" },
  }, res);

  assert.equal(res.statusCode, 503);
  const body = json(res);
  assert.equal(body.error, "siteforge_build_not_persisted");
  assert.ok(body.failures.includes("generation_fingerprint_not_persisted"));
  assert.ok(body.failures.includes("preview_url_not_persisted"));
  assert.ok(body.failures.includes("report_url_not_persisted"));
  assert.equal(calls.build[0].options.persist, true);
  assert.equal(calls.fetch.length, 0);
  assert.equal(calls.email.length, 0);
});

test("configured owner-copy cc is rejected before composition or send", async () => {
  process.env.GHOST_AGENCY_OUTREACH_CC = "audit-copy@example.test";
  const calls = { select: [], fetch: [], email: [] };
  let ownerPathCalls = 0;
  const handler = testHandler({
    calls,
    invokeOwnerEmailPath: async () => {
      ownerPathCalls += 1;
      throw new Error("owner email path must not run with configured cc");
    },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1", action: "send", confirmation: SEND_CONFIRMATION },
  }, res);

  assert.equal(res.statusCode, 422);
  assert.equal(json(res).error, "recipient_gate_failed");
  assert.equal(json(res).details.ccCount, 1);
  assert.equal(ownerPathCalls, 0);
  assert.equal(calls.email.length, 0);
});

test("backend route rejects a composed bcc before the live owner path", async () => {
  const calls = { select: [], fetch: [], email: [] };
  const ownerPathDryRuns = [];
  const handler = testHandler({
    calls,
    invokeOwnerEmailPath: async ({ dryRun }) => {
      ownerPathDryRuns.push(dryRun);
      return {
        envelope: { to: OWNER_EMAIL, cc: [], bcc: ["hidden-copy@example.test"] },
        result: {
          ok: true,
          mode: "dry_run",
          subject: "Blocked bcc",
          htmlPreview: "<!doctype html><html><body>Blocked bcc</body></html>",
        },
      };
    },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1", action: "send", confirmation: SEND_CONFIRMATION },
  }, res);

  assert.equal(res.statusCode, 422);
  assert.equal(json(res).error, "recipient_gate_failed");
  assert.equal(json(res).details.bccCount, 1);
  assert.deepEqual(ownerPathDryRuns, [true]);
  assert.equal(calls.email.length, 0);
});

test("backend route checks the exact recipient field used by the provider path", async () => {
  const calls = { select: [], fetch: [], email: [] };
  let providerSendCalls = 0;
  const handler = testHandler({
    calls,
    invokeOwnerEmailPath: async ({ dryRun, deps }) => {
      if (dryRun) {
        return {
          envelope: { to: OWNER_EMAIL, cc: [], bcc: [] },
          result: {
            ok: true,
            mode: "dry_run",
            subject: "Owner smoke preview",
            bodyPreview: "Owner smoke preview body",
            htmlPreview: "<!doctype html><html><body>Owner smoke preview</body></html>",
          },
        };
      }
      const result = await deps.sendSequenceStep({
        prospect: {
          email: "",
          ownerEmail: "wrong-recipient@example.test",
          owner_email: OWNER_EMAIL,
        },
        dryRun: false,
      });
      return { envelope: { to: OWNER_EMAIL, cc: [], bcc: [] }, result };
    },
    sendSequenceStep: async () => {
      providerSendCalls += 1;
      return { ok: true, mode: "sent", id: "must-not-send" };
    },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1", action: "send", confirmation: SEND_CONFIRMATION },
  }, res);

  assert.equal(res.statusCode, 422);
  assert.equal(json(res).error, "recipient_gate_failed");
  assert.equal(providerSendCalls, 0);
});

for (const drift of [
  {
    name: "owner",
    apply() { process.env.GHOST_AGENCY_OWNER_EMAIL = "drifted-owner@example.test"; },
  },
  {
    name: "cc",
    apply() { process.env.GHOST_AGENCY_OUTREACH_CC = "drifted-copy@example.test"; },
  },
]) {
  test(`backend route rejects ${drift.name} configuration drift before the provider send`, async () => {
    const calls = { select: [], fetch: [], email: [] };
    const ownerPathDryRuns = [];
    let providerSendCalls = 0;
    const handler = testHandler({
      calls,
      invokeOwnerEmailPath: async ({ dryRun, deps }) => {
        ownerPathDryRuns.push(dryRun);
        if (dryRun) {
          return {
            envelope: { to: OWNER_EMAIL, cc: [], bcc: [] },
            result: {
              ok: true,
              mode: "dry_run",
              subject: "Owner smoke preview",
              bodyPreview: "Owner smoke preview body",
              htmlPreview: "<!doctype html><html><body>Owner smoke preview</body></html>",
            },
          };
        }
        drift.apply();
        const result = await deps.sendSequenceStep({
          prospect: { email: OWNER_EMAIL, owner_email: OWNER_EMAIL },
          dryRun: false,
        });
        return { envelope: { to: OWNER_EMAIL, cc: [], bcc: [] }, result };
      },
      sendSequenceStep: async () => {
        providerSendCalls += 1;
        return { ok: true, mode: "sent", id: "must-not-send" };
      },
    });
    const res = mockRes();
    await handler({
      method: "POST",
      headers: adminHeaders(),
      body: { prospectId: "persisted-owner-smoke-1", action: "send", confirmation: SEND_CONFIRMATION },
    }, res);

    assert.equal(res.statusCode, 422);
    assert.equal(json(res).error, "recipient_gate_failed");
    assert.deepEqual(ownerPathDryRuns, [true, false]);
    assert.equal(providerSendCalls, 0);
  });
}

test("recipient gate rejects any composed cc before a send can start", async () => {
  const calls = { select: [], fetch: [], email: [] };
  const handler = testHandler({
    calls,
    sendSequenceStep: async (input) => {
      calls.email.push(input);
      return {
        ok: true,
        mode: "dry_run",
        cc: ["audit@example.test"],
        subject: "Blocked",
        htmlPreview: "<!doctype html><html><body>Blocked</body></html>",
      };
    },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1", action: "send", confirmation: SEND_CONFIRMATION },
  }, res);

  assert.equal(res.statusCode, 422);
  assert.equal(json(res).error, "recipient_gate_failed");
  assert.equal(calls.email.length, 1);
  assert.equal(calls.email[0].dryRun, true);
});

test("send requires the exact one-prospect confirmation phrase", async () => {
  const calls = { select: [], fetch: [], email: [] };
  const handler = testHandler({ calls });

  const missing = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1", action: "send" },
  }, missing);
  assert.equal(missing.statusCode, 400);
  assert.equal(json(missing).error, "send_confirmation_required");

  const wrong = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1", action: "send", confirmation: "SEND_OWNER_FIVE" },
  }, wrong);
  assert.equal(wrong.statusCode, 400);
  assert.equal(json(wrong).error, "send_confirmation_required");
  assert.equal(calls.select.length, 0);
  assert.equal(calls.email.length, 0);

  const confirmed = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1", action: "send", confirmation: SEND_CONFIRMATION },
  }, confirmed);
  assert.equal(confirmed.statusCode, 200);
  assert.equal(json(confirmed).status, "owner_sent");
  assert.deepEqual(json(confirmed).delivery, { to: OWNER_EMAIL, cc: [], bcc: [] });
  assert.deepEqual(calls.email.map((call) => call.dryRun), [true, false]);
  assert.ok(calls.email.every((call) => call.prospect.email === OWNER_EMAIL));
});

test("a durable owner-delivery claim prevents a repeated provider send", async () => {
  const calls = { select: [], fetch: [], email: [] };
  let claimCalls = 0;
  const handler = testHandler({
    calls,
    claimOwnerDelivery: async () => {
      claimCalls += 1;
      return claimCalls === 1
        ? { mode: "live_write" }
        : { mode: "live_write_failed", status: 409 };
    },
  });
  const request = {
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1", action: "send", confirmation: SEND_CONFIRMATION },
  };

  const first = mockRes();
  await handler(request, first);
  assert.equal(first.statusCode, 200);
  assert.equal(json(first).status, "owner_sent");

  const repeated = mockRes();
  await handler(request, repeated);
  assert.equal(repeated.statusCode, 409);
  assert.equal(json(repeated).error, "owner_delivery_already_claimed_or_unavailable");
  assert.equal(claimCalls, 2);
  assert.equal(calls.email.filter((call) => call.dryRun === false).length, 1);
});

test("failed renderer and QC signals block before email rendering", async () => {
  const calls = { select: [], fetch: [], email: [], build: [] };
  const row = unbuiltProspect();
  const handler = testHandler({
    row,
    calls,
    buildPreviewForProspect: async (prospect) => {
      calls.build.push(prospect.prospect_id);
      return {
        ok: true,
        prospect_id: prospect.prospect_id,
        status: "previewed",
        renderer: "05-build-v7",
        generation_fingerprint: "composition-legacy-v7",
        qc_passed: false,
        visual_qc_passed: false,
        qc_contract: "public-surface-v2",
        preview_url: "https://previews.wss-ai.com/blocked",
        report_url: "https://reports.wss-ai.com/blocked",
      };
    },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1" },
  }, res);

  assert.equal(res.statusCode, 422);
  const body = json(res);
  assert.equal(body.error, "siteforge_qc_blocked");
  assert.ok(body.failures.includes("renderer_not_allowed"));
  assert.ok(body.failures.includes("qc_not_passed"));
  assert.ok(body.failures.includes("visual_qc_not_passed"));
  assert.equal(calls.build.length, 1);
  assert.equal(calls.email.length, 0);
});

test("a durable SiteForge job still running returns a resumable 202 without composing email", async () => {
  const calls = { select: [], fetch: [], email: [], build: [] };
  const row = unbuiltProspect();
  const handler = testHandler({
    row,
    calls,
    buildPreviewForProspect: async (prospect) => {
      calls.build.push(prospect.prospect_id);
      return {
        ok: false,
        pending: true,
        prospect_id: prospect.prospect_id,
        status: "new",
        preview_url: null,
        report_url: null,
      };
    },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1" },
  }, res);

  assert.equal(res.statusCode, 202);
  const body = json(res);
  assert.equal(body.status, "build_pending");
  assert.equal(body.resumable, true);
  assert.equal(body.reason, "siteforge_durable_job_pending");
  assert.equal(body.retry.body.action, "compose");
  assert.equal(calls.email.length, 0);
});

test("an unfinished replacement build returns a resumable 202 before the route budget", async () => {
  const calls = { select: [], fetch: [], email: [], build: [] };
  const row = persistedProspect({
    preview_url: "https://preview.example.test/not-real",
    report_url: "https://report.example.test/not-real",
  });
  const handler = testHandler({
    row,
    calls,
    buildBudgetMs: 5,
    buildPreviewForProspect: async (prospect) => {
      calls.build.push(prospect.prospect_id);
      return new Promise(() => {});
    },
  });
  const res = mockRes();
  await handler({
    method: "POST",
    headers: adminHeaders(),
    body: { prospectId: "persisted-owner-smoke-1" },
  }, res);

  assert.equal(res.statusCode, 202);
  const body = json(res);
  assert.equal(body.status, "build_pending");
  assert.equal(body.resumable, true);
  assert.equal(body.reason, "persisted_artifact_unreachable");
  assert.equal(body.retry.body.prospectId, "persisted-owner-smoke-1");
  assert.equal(body.retry.body.action, "compose");
  assert.equal(res.headers["Retry-After"], "3");
  assert.equal(calls.build.length, 1);
  assert.equal(calls.email.length, 0);
});
