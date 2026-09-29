import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { notifyGhostBuildTerminal, notifyGhostBuildTerminalWithRetry } from "../lib/ghost-callback.mjs";

function releaseEvidence() {
  return {
    schema: "siteforge-release-evidence-v1",
    map: {
      verified: true,
      qc_check: { name: "release-map-evidence", detail: "verified" },
      artifact: "screenshots/desktop/map.png",
      evidence_artifact: "screenshots/map-evidence.json",
      manifest_artifact: "screenshots/manifest.json",
      screenshot: { size: 4096, sha256: "c".repeat(64) },
      runtime: { response_ok: true, geometry_ok: true, pixels_ok: true, unique_colors: 32, variance: 120 },
      manifest: { schema: "siteforge-screenshot-manifest-v1", map_pass: true },
      supporting_checks: [
        { name: "visual-satellite-map-evidence", pass: true, detail: "verified" },
        { name: "visual-address-map-directions", pass: true, detail: "verified" },
      ],
    },
    identity: {
      verified: true,
      qc_check: { name: "release-business-identity-match", detail: "matched" },
      expected: { business_name: "North Star Plumbing" },
      actual: { business_name: "North Star Plumbing", public_packet_business_name: "North Star Plumbing", local_business_nodes: 1 },
    },
    template_family: {
      verified: true,
      qc_check: { name: "release-template-family-match", detail: "matched" },
      expected: { family: "service-map-pins" },
      actual: { family: "service-map-pins" },
    },
  };
}

// The 108-Point Authority Standard's fabrication-relevant checks (41, 65, 69)
// are folded into qc_passed (see ghost-build-contract.mjs), which this
// callback path reads. Mirrors what the real pipeline always attaches via
// packet.authority_standard.
function passingAuthorityStandard() {
  return {
    standard: "authority-108-v1",
    total: 108,
    checks: [
      { id: 41, key: "aeo-and-geo-41", status: "passed" },
      { id: 65, key: "trust-and-e-e-a-t-65", status: "not_applicable" },
      { id: 69, key: "trust-and-e-e-a-t-69", status: "passed" },
    ],
  };
}

function doneJob() {
  return {
    id: "callback-job", status: "done", correlation_id: "ghost-job", ghost_context: {
      prospect: { prospect_id: "prospect-42", business_name: "North Star Plumbing" }, compiled: {}, checkout_url: "",
    },
    result: {
      preview: "/try/north-star/", generation_fingerprint: "a".repeat(64),
      authority_standard: passingAuthorityStandard(),
      release_evidence: releaseEvidence(),
      qc: { grade: "A", visual: true, degraded: false, contract: "public-surface-v2", score: 97 },
    },
  };
}

test("terminal callback is server-configured, HTTPS-only, and carries no credential in its body", async () => {
  let request;
  const result = await notifyGhostBuildTerminal({
    job: doneJob(), baseUrl: "https://siteforge.example",
    env: { SITEFORGE_GHOST_CALLBACK_URL: "https://ghost.example/api/webhooks/siteforge", SITEFORGE_GHOST_CALLBACK_TOKEN: "callback-secret" },
    fetchImpl: async (url, options) => { request = { url, options }; return new Response("{}", { status: 200 }); },
  });
  assert.deepEqual(result, { sent: true, status: 200, reason: "sent" });
  assert.equal(request.url.toString(), "https://ghost.example/api/webhooks/siteforge");
  assert.equal(request.options.headers.authorization, "Bearer callback-secret");
  const body = JSON.parse(request.options.body);
  assert.equal(body.job_id, "callback-job");
  assert.equal(body.correlation_id, "ghost-job");
  assert.equal(body.prospect_id, "prospect-42");
  assert.equal(body.qc_passed, true);
  assert.equal(body.release_evidence.map.screenshot_url, "https://siteforge.example/try/north-star/screenshots/desktop/map.png");
  assert.equal(body.release_evidence.identity.actual.business_name, "North Star Plumbing");
  assert.equal(body.release_evidence.template_family.actual.family, "service-map-pins");
  assert.doesNotMatch(request.options.body, /callback-secret/);
});

test("terminal callback preserves fresh canonical truth and rendered hero evidence", async () => {
  let callbackBody;
  const job = doneJob();
  job.ghost_context.compiled = {
    version: "intake-genie-v1",
    facts: {
      name: "North Star Plumbing",
      branding: { colors: ["#005A9C", "#8A2BE2"] },
    },
    assets: [{
      kind: "photo",
      url: "https://media.north-star.example/crew.webp",
      approved: true,
    }],
    evidence: [{ field: "facts.name", source: "business-site" }],
    hero_media: {
      selected: {
        kind: "photo",
        url: "https://media.north-star.example/crew.webp",
        source: "business-site",
        hero_eligible: true,
        proof_eligible: true,
        truthful_source: true,
      },
      eligible: [{
        kind: "photo",
        url: "https://media.north-star.example/crew.webp",
        source: "business-site",
        hero_eligible: true,
        proof_eligible: true,
        truthful_source: true,
      }],
    },
  };

  const result = await notifyGhostBuildTerminal({
    job,
    baseUrl: "https://siteforge.example",
    env: {
      SITEFORGE_GHOST_CALLBACK_URL: "https://ghost.example/api/webhooks/siteforge",
      SITEFORGE_GHOST_CALLBACK_TOKEN: "callback-secret",
    },
    fetchImpl: async (_url, options) => {
      callbackBody = JSON.parse(options.body);
      return new Response("{}", { status: 200 });
    },
  });

  assert.equal(result.sent, true);
  assert.deepEqual(callbackBody.truth_packet.facts, job.ghost_context.compiled.facts);
  assert.deepEqual(callbackBody.truth_packet.assets, job.ghost_context.compiled.assets);
  assert.deepEqual(callbackBody.truth_packet.evidence, job.ghost_context.compiled.evidence);
  assert.deepEqual(callbackBody.hero_media, job.ghost_context.compiled.hero_media);
  assert.equal(callbackBody.hero_media.selected.url, "https://media.north-star.example/crew.webp");
  assert.equal(callbackBody.hero_media.selected.truthful_source, true);
  assert.doesNotMatch(JSON.stringify(callbackBody), /callback-secret/);
});

test("terminal callback keeps the legacy result hero evidence fallback", async () => {
  let callbackBody;
  const job = doneJob();
  job.result.hero_media = {
    selected: {
      kind: "video",
      url: "https://media.north-star.example/crew.mp4",
      source: "business-site",
      hero_eligible: true,
      proof_eligible: true,
      truthful_source: true,
    },
    eligible: [],
  };

  await notifyGhostBuildTerminal({
    job,
    baseUrl: "https://siteforge.example",
    env: {
      SITEFORGE_GHOST_CALLBACK_URL: "https://ghost.example/api/webhooks/siteforge",
      SITEFORGE_GHOST_CALLBACK_TOKEN: "callback-secret",
    },
    fetchImpl: async (_url, options) => {
      callbackBody = JSON.parse(options.body);
      return new Response("{}", { status: 200 });
    },
  });

  assert.deepEqual(callbackBody.hero_media, job.result.hero_media);
  assert.equal(callbackBody.truth_packet.hero_media, undefined);
});

test("terminal callback does nothing until dedicated server credentials exist", async () => {
  const result = await notifyGhostBuildTerminal({ job: doneJob(), baseUrl: "https://siteforge.example", env: {}, fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.deepEqual(result, { sent: false, reason: "callback_not_configured" });
});

test("terminal callback rejection exposes only the nonsecret HTTP status", async () => {
  const secretResponseBody = JSON.stringify({ error: "do-not-log-this-body", token: "do-not-log-this-token" });
  const result = await notifyGhostBuildTerminal({
    job: doneJob(), baseUrl: "https://siteforge.example",
    env: { SITEFORGE_GHOST_CALLBACK_URL: "https://ghost.example/api/webhooks/siteforge", SITEFORGE_GHOST_CALLBACK_TOKEN: "callback-secret" },
    fetchImpl: async () => new Response(secretResponseBody, { status: 401 }),
  });
  assert.deepEqual(result, { sent: false, status: 401, reason: "callback_rejected" });
  assert.doesNotMatch(JSON.stringify(result), /do-not-log-this|callback-secret/);
});

test("terminal callback warning logs the reason and status without request details", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const start = server.indexOf("function scheduleGhostTerminalCallback");
  const end = server.indexOf("\n}\n", start) + 2;
  const callbackLogger = server.slice(start, end);
  assert.match(callbackLogger, /Number\.isInteger\(outcome\.status\)/);
  assert.match(callbackLogger, /`status=\$\{callbackStatus\}`/);
  assert.doesNotMatch(callbackLogger, /outcome\.(?:body|url|headers|token)/);
});

test("blocked terminal builds still identify the originating Ghost prospect", async () => {
  let body;
  const failed = { ...doneJob(), status: "blocked", result: null, error_code: "visual_qc_incomplete", error: "Visual QC held" };
  failed.ghost_context.compiled = {
    facts: { name: "North Star Plumbing" },
    assets: [],
    evidence: [{ field: "facts.name", source: "business-site" }],
    hero_media: {
      selected: {
        kind: "photo",
        url: "https://media.north-star.example/blocked-build.webp",
        source: "business-site",
        truthful_source: true,
      },
      eligible: [],
    },
  };
  const result = await notifyGhostBuildTerminal({
    job: failed, baseUrl: "https://siteforge.example",
    env: { SITEFORGE_GHOST_CALLBACK_URL: "https://ghost.example/api/webhooks/siteforge", SITEFORGE_GHOST_CALLBACK_TOKEN: "callback-secret" },
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return new Response("{}", { status: 200 }); },
  });
  assert.equal(result.sent, true);
  assert.equal(body.job_id, "callback-job");
  assert.equal(body.correlation_id, "ghost-job");
  assert.equal(body.prospect_id, "prospect-42");
  assert.deepEqual(body.truth_packet, failed.ghost_context.compiled);
  assert.deepEqual(body.hero_media, failed.ghost_context.compiled.hero_media);
  assert.deepEqual(body.blocked, ["visual_qc_incomplete"]);
});

test("terminal callback retries only the short durable-store terminal race", async () => {
  let reads = 0;
  let waits = 0;
  const outcome = await notifyGhostBuildTerminalWithRetry({
    jobId: "callback-job", baseUrl: "https://siteforge.example",
    env: { SITEFORGE_GHOST_CALLBACK_URL: "https://ghost.example/api/webhooks/siteforge", SITEFORGE_GHOST_CALLBACK_TOKEN: "callback-secret" },
    getJob: async () => (++reads === 1 ? { id: "callback-job", status: "running" } : doneJob()),
    fetchImpl: async () => new Response("{}", { status: 200 }),
    wait: async () => { waits += 1; },
  });
  assert.deepEqual(outcome, { sent: true, status: 200, reason: "sent" });
  assert.equal(reads, 2);
  assert.equal(waits, 1);
});
