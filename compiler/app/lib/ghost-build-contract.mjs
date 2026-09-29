const TERMINAL_FAILURES = new Set(["blocked", "failed", "timed_out"]);
const PROJECT_PRECERTIFICATION_POLICY = "project-precertification";

// The 108-Point Authority Standard (factory/authority/authority-standard.mjs)
// computes real fabrication/identity-adjacent signals — e.g. "Claims retain
// clear source citations" (checks 41/69) and "Quoted reviews are real and
// attributed" (check 65) — but until now nothing read authority_standard when
// deciding qc_passed, so a build that failed those checks still shipped as
// ready. These three keys are the ones that are clearly about factual/
// identity fabrication rather than cosmetic polish; fold them into the
// blocking gate below. Fail-closed: if authority_standard is missing
// entirely, treat it as not verified.
const AUTHORITY_FABRICATION_CHECK_KEYS = new Set([
  "aeo-and-geo-41",
  "trust-and-e-e-a-t-65",
  "trust-and-e-e-a-t-69",
]);

function authorityStandardFabricationChecksPass(authorityStandard) {
  if (!authorityStandard || !Array.isArray(authorityStandard.checks)) return false;
  const relevant = authorityStandard.checks.filter((check) => AUTHORITY_FABRICATION_CHECK_KEYS.has(check?.key));
  if (relevant.length !== AUTHORITY_FABRICATION_CHECK_KEYS.size) return false;
  return relevant.every((check) => check.status !== "failed");
}

function cleanBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function previewUrlFor(baseUrl, previewPath) {
  const base = cleanBaseUrl(baseUrl);
  const path = String(previewPath || "").trim();
  if (!base || !path) return "";
  if (/^https?:\/\//i.test(path)) return path.endsWith("/") ? path : `${path}/`;
  const rooted = path.startsWith("/") ? path : `/${path}`;
  return `${base}${rooted.endsWith("/") ? rooted : `${rooted}/`}`;
}

function releaseIdentityKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(" ") || "";
}

function releaseWebsiteHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.hostname.toLocaleLowerCase("en-US").replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

function expectedReleaseIdentity(context = {}) {
  const prospect = context.prospect || {};
  const compiled = context.compiled || {};
  const facts = compiled.intakeGenie?.facts || compiled.facts || {};
  const first = (...values) => values.find((value) => String(value || "").trim()) || "";
  return {
    business_name: first(prospect.business_name, prospect.name, facts.business_name, facts.name, compiled.business_name, compiled.name),
    city: first(prospect.city, facts.city, compiled.city),
    state: first(prospect.state, facts.state, compiled.state),
    source_website: first(
      prospect.source_website,
      prospect.website_url,
      prospect.website,
      prospect.current_website,
      facts.source_website,
      facts.website_url,
      facts.website,
      facts.current_website,
      compiled.source_website,
      compiled.website_url,
      compiled.website,
      compiled.current_website,
    ),
  };
}

function exactReleaseFieldMatches(expected, rendered, publicPacket) {
  const expectedKey = releaseIdentityKey(expected);
  if (!expectedKey) return true;
  return (
    expectedKey === releaseIdentityKey(rendered) &&
    expectedKey === releaseIdentityKey(publicPacket)
  );
}

function exactReleaseWebsiteMatches(expected, rendered, publicPacket) {
  const expectedHost = releaseWebsiteHost(expected);
  if (expectedHost === "") return true;
  if (!expectedHost) return false;
  return (
    expectedHost === releaseWebsiteHost(rendered) &&
    expectedHost === releaseWebsiteHost(publicPacket)
  );
}

function releaseEvidenceComplete(evidence, contextExpected = {}) {
  if (evidence?.schema !== "siteforge-release-evidence-v1") return false;
  const map = evidence.map || {};
  const identity = evidence.identity || {};
  const family = evidence.template_family || {};
  const mapChecks = new Map((map.supporting_checks || []).map((check) => [check.name, check]));
  const expectedName = releaseIdentityKey(identity.expected?.business_name);
  const actualName = releaseIdentityKey(identity.actual?.business_name);
  const packetName = releaseIdentityKey(identity.actual?.public_packet_business_name);
  const contextName = releaseIdentityKey(contextExpected.business_name);
  const expectedCity = identity.expected?.city;
  const expectedState = identity.expected?.state;
  const expectedWebsite = identity.expected?.source_website;
  const contextCity = contextExpected.city;
  const contextState = contextExpected.state;
  const contextWebsite = contextExpected.source_website;
  const expectedEntityBound = Boolean(
    (!contextName || contextName === expectedName) &&
    exactReleaseFieldMatches(contextCity, expectedCity, expectedCity) &&
    exactReleaseFieldMatches(contextState, expectedState, expectedState) &&
    exactReleaseWebsiteMatches(contextWebsite, expectedWebsite, expectedWebsite) &&
    exactReleaseFieldMatches(
      expectedCity || contextCity,
      identity.actual?.city,
      identity.actual?.public_packet_city,
    ) &&
    exactReleaseFieldMatches(
      expectedState || contextState,
      identity.actual?.state,
      identity.actual?.public_packet_state,
    ) &&
    exactReleaseWebsiteMatches(
      expectedWebsite || contextWebsite,
      identity.actual?.source_website,
      identity.actual?.public_packet_source_website,
    )
  );
  // Minimum-QC policy (owner directive, 2026-07-21): map and template-family
  // evidence are advisory. A waived section (waived: true) carries its real
  // unverified capture data and is accepted without the strict screenshot/
  // runtime/manifest proof. Identity NEVER waives — the wrong business is the
  // one release failure no policy may soften.
  const mapComplete = map.waived === true
    ? map.qc_check?.name === "release-map-evidence"
    : Boolean(
      map.verified === true &&
      map.qc_check?.name === "release-map-evidence" &&
      map.artifact === "screenshots/desktop/map.png" &&
      map.evidence_artifact === "screenshots/map-evidence.json" &&
      map.manifest_artifact === "screenshots/manifest.json" &&
      Number(map.screenshot?.size || 0) > 64 &&
      /^[a-f0-9]{64}$/.test(String(map.screenshot?.sha256 || "")) &&
      map.runtime?.response_ok === true &&
      map.runtime?.geometry_ok === true &&
      map.runtime?.pixels_ok === true &&
      Number(map.runtime?.unique_colors || 0) >= 16 &&
      Number(map.runtime?.variance || 0) >= 80 &&
      map.manifest?.schema === "siteforge-screenshot-manifest-v1" &&
      map.manifest?.map_pass === true &&
      mapChecks.get("visual-satellite-map-evidence")?.pass === true &&
      mapChecks.get("visual-address-map-directions")?.pass === true
    );
  const familyComplete = family.waived === true
    ? family.qc_check?.name === "release-template-family-match"
    : Boolean(
      family.verified === true &&
      family.qc_check?.name === "release-template-family-match" &&
      family.expected?.family &&
      (
        (
          family.expected.family === "auto" &&
          family.expected.selection === "auto" &&
          family.expected.source === "stage_payload.release_expectation.template_family" &&
          family.actual?.known_family === true &&
          family.actual?.source === "rendered:packet.json#hero_family" &&
          Boolean(family.actual?.family)
        ) ||
        (
          family.expected.family !== "auto" &&
          family.expected.family === family.actual?.family
        )
      )
    );
  return Boolean(
    mapComplete &&
    identity.verified === true &&
    identity.qc_check?.name === "release-business-identity-match" &&
    expectedName && expectedName === actualName && expectedName === packetName &&
    expectedEntityBound &&
    Number(identity.actual?.local_business_nodes || 0) === 1 &&
    familyComplete
  );
}

function releaseEvidenceForPublicContract(evidence, previewUrl) {
  if (!evidence) return null;
  const released = structuredClone(evidence);
  if (!previewUrl) return released;
  released.map.screenshot_url = new URL(released.map.artifact, previewUrl).toString();
  released.map.evidence_url = new URL(released.map.evidence_artifact, previewUrl).toString();
  released.map.manifest_url = new URL(released.map.manifest_artifact, previewUrl).toString();
  released.identity.rendered_page_url = previewUrl;
  released.identity.public_packet_url = new URL("packet.json", previewUrl).toString();
  released.template_family.public_packet_url = new URL("packet.json", previewUrl).toString();
  return released;
}

function intakeSummary(compiled = {}, jobId = "") {
  return {
    version: compiled.version || null,
    job_id: jobId || compiled.job_id || null,
    cache: compiled.cache || null,
  };
}

export function ghostBuildStatusUrl(baseUrl, jobId) {
  return `${cleanBaseUrl(baseUrl)}/api/ghost-agency/build-preview/${encodeURIComponent(jobId)}`;
}

export function queuedGhostBuildContract({ baseUrl, job, compiled = {}, correlationId = "" }) {
  const jobId = String(job?.id || "");
  return {
    statusCode: 202,
    body: {
      ok: true,
      status: "queued",
      pending: true,
      job_id: jobId,
      correlation_id: correlationId || job?.correlation_id || jobId,
      status_url: ghostBuildStatusUrl(baseUrl, jobId),
      retry_after_seconds: 3,
      intake: intakeSummary(compiled, jobId),
    },
  };
}

export function ghostBuildContractForJob({ baseUrl, job }) {
  const context = job?.ghost_context || {};
  const compiled = context.compiled || {};
  const prospect = context.prospect || {};
  const jobId = String(job?.id || "");
  const correlationId = job?.correlation_id || context.correlation_id || jobId;

  if (!job || !jobId) {
    return { statusCode: 404, body: { ok: false, status: "missing", error: "job_not_found" } };
  }

  if (TERMINAL_FAILURES.has(job.status)) {
    return {
      statusCode: 422,
      body: {
        ok: false,
        status: job.status,
        pending: false,
        job_id: jobId,
        correlation_id: correlationId,
        code: job.error_code || "siteforge_build_failed",
        error: job.error || "WSS Launch build failed safely.",
        intake: intakeSummary(compiled, jobId),
      },
    };
  }

  if (job.status !== "done" || !job.result) {
    const queued = queuedGhostBuildContract({ baseUrl, job, compiled, correlationId });
    queued.body.status = job.status || "queued";
    queued.body.stage = job.current_stage || "queued";
    queued.body.phase = job.current_phase || "waiting";
    return queued;
  }

  const built = job.result;
  const qc = built.qc || {};
  const grade = String(qc.grade || "").toUpperCase();
  const qcContract = String(qc.contract || "");
  const visualQcPassed = qc.visual === true;
  const projectPrecertified = Boolean(
    grade === "B" &&
    qc.precertified === true &&
    qc.precertification_policy === PROJECT_PRECERTIFICATION_POLICY
  );
  const releaseEvidenceValid = releaseEvidenceComplete(
    built.release_evidence,
    expectedReleaseIdentity(context),
  );
  const authorityStandard = built.authority_standard || null;
  const authorityFabricationValid = authorityStandardFabricationChecksPass(authorityStandard);
  const candidatePreviewUrl = previewUrlFor(baseUrl, built.preview);
  const qcPassed = Boolean(
    candidatePreviewUrl &&
    built.generation_fingerprint &&
    qcContract === "public-surface-v2" &&
    visualQcPassed &&
    (grade === "A" || projectPrecertified) &&
    qc.degraded !== true &&
    releaseEvidenceValid &&
    authorityFabricationValid
  );
  const previewUrl = qcPassed ? candidatePreviewUrl : "";
  const reportUrl = previewUrl ? `${previewUrl}scorecard.json` : "";
  const optimizationManifestUrl = previewUrl ? `${previewUrl}optimization-manifest.json` : "";
  const releaseEvidence = releaseEvidenceForPublicContract(built.release_evidence, previewUrl);
  const blockedCode = !releaseEvidenceValid
    ? "release_evidence_incomplete"
    : !authorityFabricationValid
      ? "authority_fabrication_check_failed"
      : "visual_qc_incomplete";

  return {
    statusCode: qcPassed ? 200 : 422,
    body: {
      ok: qcPassed,
      status: qcPassed ? "ready" : "blocked",
      pending: false,
      job_id: jobId,
      correlation_id: correlationId,
      renderer: "05-build-v8",
      generation_fingerprint: built.generation_fingerprint || null,
      qc_passed: qcPassed,
      visual_qc_passed: visualQcPassed,
      qc_contract: qcContract || null,
      grade: grade || null,
      score: qc.score ?? null,
      precertified: projectPrecertified,
      precertification_policy: projectPrecertified ? PROJECT_PRECERTIFICATION_POLICY : null,
      authority_standard: authorityStandard?.standard || "authority-108-v1",
      authority_summary: authorityStandard,
      release_evidence: releaseEvidence,
      ...(!qcPassed ? {
        code: blockedCode,
        error: releaseEvidenceValid
          ? "The public-surface quality contract did not pass."
          : "The release evidence contract is incomplete or contradictory.",
      } : {}),
      urls: qcPassed ? {
        preview_url: previewUrl,
        report_url: reportUrl,
        optimization_manifest_url: optimizationManifestUrl,
      } : {},
      preview_url: previewUrl || null,
      report_url: reportUrl || null,
      optimization_manifest_url: optimizationManifestUrl || null,
      payload: {
        prospect: {
          ...prospect,
          preview_url: previewUrl || null,
          report_url: reportUrl || null,
          optimization_manifest_url: optimizationManifestUrl || null,
          authority_standard: authorityStandard,
          generation_fingerprint: built.generation_fingerprint || null,
          release_evidence: releaseEvidence,
          checkout_url: context.checkout_url || prospect.checkout_url || "",
        },
        truth_packet: {
          ...compiled,
          authority_standard: authorityStandard,
          generation_fingerprint: built.generation_fingerprint || null,
          release_evidence: releaseEvidence,
        },
      },
      intake: intakeSummary(compiled, jobId),
    },
  };
}
