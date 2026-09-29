"use strict";

// Line-only durable deployment resolver.
//
// A Mirror Engine create can succeed at Vercel and then lose its caller before
// the Line checkpoints or attaches the alias. A later retry searches deployment
// metadata using the secret-bound operation receipt. The exact build hash is
// preferred, but production also proved that one durable operation can regenerate
// a different metadata build hash before its previous READY artifact is
// checkpointed. That must not force another blind deploy: the engine still owns
// the final decision because it byte-diffs every recovered candidate against the
// CURRENT finalFiles and deep-link probes it before aliasing.
//
// Safety posture stays fail-closed:
//   - every same-operation candidate must belong to the requested isolated project;
//   - the Ghost backend project/name is forbidden;
//   - deployment IDs and *.vercel.app URLs must be structurally valid;
//   - exact operation+build_hash READY candidates always win;
//   - when no exact hash exists, only the newest READY candidate from the SAME
//     secret-bound operation may be offered as a byte-proof fallback;
//   - if any same-operation deployment is still BUILDING/QUEUED and there is no
//     READY candidate, return retryable instead of creating another deployment;
//   - the Mirror Engine still byte-diffs and deep-link probes the returned
//     candidate before it may move the alias.

const deploy = require("./mirror-engine/deploy");

const HARD_BACKEND_PROJECT_ID = "prj_WHDPMZW56KiNFpcKt8DGgsUdxwyU";
const HARD_BACKEND_PROJECT_NAME = "ghost-agency-backend";

function text(value) {
  return String(value == null ? "" : value).trim();
}

function backendProjectIds() {
  return new Set([
    text(process.env.VERCEL_PROJECT_ID),
    HARD_BACKEND_PROJECT_ID,
  ].filter(Boolean));
}

function backendProjectNames() {
  return new Set([
    text(process.env.VERCEL_PROJECT_NAME).toLowerCase(),
    HARD_BACKEND_PROJECT_NAME,
  ].filter(Boolean));
}

function deploymentProjectId(dep) {
  return dep && (dep.projectId || (dep.project && dep.project.id) || "");
}

function validDeploymentUrl(value) {
  return /^[a-z0-9](?:[a-z0-9-]{0,198}[a-z0-9])?\.vercel\.app$/i.test(text(value));
}

function normalizeCandidate(dep, projectId) {
  const uid = text(dep && dep.uid);
  const legacyId = text(dep && dep.id);
  const deployId = uid || legacyId;
  const deploymentIdConflict = Boolean(uid && legacyId && uid !== legacyId);
  const depProjectId = text(deploymentProjectId(dep));
  const depName = text(dep && (dep.name || (dep.project && dep.project.name))).toLowerCase();

  if (
    depProjectId !== projectId
    || backendProjectIds().has(depProjectId)
    || backendProjectNames().has(depName)
  ) {
    return {
      ok: false,
      result: { found: false, refused: true, reason: "deployment_wrong_project", actual_project_id: depProjectId },
    };
  }
  if (deploymentIdConflict || !deployId || !validDeploymentUrl(dep && dep.url)) {
    return {
      ok: false,
      result: { found: false, refused: true, reason: "deployment_invalid_identity" },
    };
  }
  return {
    ok: true,
    deployment: {
      id: deployId,
      url: text(dep.url),
      readyState: text(dep.readyState),
    },
    projectId: depProjectId,
    buildHash: text(dep && dep.meta && dep.meta.build_hash),
  };
}

async function resolveLineTaggedDeployment(
  { projectId, buildHash, operationKeyHmacSha256 } = {},
  { signal, deadlineAt } = {},
) {
  const expectedProjectId = text(projectId);
  const expectedBuildHash = text(buildHash);
  const operationHash = text(operationKeyHmacSha256);
  if (!expectedProjectId || !expectedBuildHash || !operationHash) {
    return { found: false, reason: "alias_not_found" };
  }

  const token = text(process.env.VERCEL_TOKEN);
  const teamId = text(process.env.VERCEL_TEAM_ID);
  if (!token || !teamId) throw new Error("VERCEL_TOKEN / VERCEL_TEAM_ID not configured");

  const params = new URLSearchParams({
    teamId,
    projectId: expectedProjectId,
    target: "production",
    limit: "20",
  });
  const response = await fetch(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: deploy.composeAbortSignal({ signal, deadlineAt }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(body.deployments)) {
    return {
      found: false,
      refused: true,
      retryable: true,
      reason: `deployment_list_http_${response.status}`,
    };
  }

  const sameOperation = body.deployments.filter((candidate) => {
    const meta = candidate && candidate.meta && typeof candidate.meta === "object" ? candidate.meta : {};
    return meta.operation_key_hmac_sha256 === operationHash;
  });
  if (!sameOperation.length) return { found: false, reason: "alias_not_found" };

  const normalized = [];
  for (const candidate of sameOperation) {
    const item = normalizeCandidate(candidate, expectedProjectId);
    if (!item.ok) return item.result;
    normalized.push(item);
  }

  const exact = normalized.filter((item) => item.buildHash === expectedBuildHash);
  const exactReady = exact.filter((item) => item.deployment.readyState === "READY");
  if (exactReady.length) {
    const winner = exactReady[0];
    return {
      found: true,
      source: "operation_metadata",
      deployment: winner.deployment,
      projectId: winner.projectId,
      duplicateExactCandidates: exact.length,
    };
  }

  if (exact.length) {
    const states = exact.map((item) => item.deployment.readyState || "unknown");
    return {
      found: false,
      refused: true,
      retryable: true,
      reason: `deployment_not_ready:${[...new Set(states)].join(",") || "unknown"}`,
    };
  }

  // HASH-DRIFT FALLBACK. This candidate is NOT trusted merely because it shares
  // the operation receipt. It is only offered to engine.js, which immediately
  // runs byteDiff(candidate.url, current finalFiles) + deepLinkCheck and will
  // create a new deployment if those bytes do not match. That makes this a safe
  // recovery optimization rather than a stale-build waiver.
  const operationReady = normalized.filter((item) => item.deployment.readyState === "READY");
  if (operationReady.length) {
    const winner = operationReady[0];
    return {
      found: true,
      source: "operation_metadata_hash_fallback",
      deployment: winner.deployment,
      projectId: winner.projectId,
      expectedBuildHash,
      candidateBuildHash: winner.buildHash,
      sameOperationCandidates: normalized.length,
      hashMismatch: true,
    };
  }

  const states = normalized.map((item) => item.deployment.readyState || "unknown");
  return {
    found: false,
    refused: true,
    retryable: true,
    reason: `deployment_not_ready:${[...new Set(states)].join(",") || "unknown"}`,
  };
}

module.exports = {
  HARD_BACKEND_PROJECT_ID,
  HARD_BACKEND_PROJECT_NAME,
  backendProjectIds,
  backendProjectNames,
  validDeploymentUrl,
  normalizeCandidate,
  resolveLineTaggedDeployment,
};
