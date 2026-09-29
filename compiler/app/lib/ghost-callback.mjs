import { ghostBuildContractForJob } from "./ghost-build-contract.mjs";

function callbackConfig(env = process.env) {
  return {
    url: String(env.SITEFORGE_GHOST_CALLBACK_URL || "").trim(),
    token: String(env.SITEFORGE_GHOST_CALLBACK_TOKEN || "").trim(),
  };
}

function recordOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function terminalPayload(contract) {
  const body = contract.body || {};
  const prospect = body.payload?.prospect || contract.job?.ghost_context?.prospect || {};
  const truthPacket = recordOrNull(body.payload?.truth_packet || contract.job?.ghost_context?.compiled);
  const heroMedia = recordOrNull(truthPacket?.hero_media)
    || recordOrNull(body.hero_media)
    || recordOrNull(contract.job?.result?.hero_media);
  return {
    status: body.status,
    job_id: body.job_id || contract.job?.id || null,
    correlation_id: body.correlation_id || contract.job?.correlation_id || null,
    prospect_id: String(prospect.prospect_id || ""),
    prospect,
    truth_packet: truthPacket,
    hero_media: heroMedia,
    urls: body.urls || {},
    preview_url: body.preview_url || null,
    report_url: body.report_url || null,
    optimization_manifest_url: body.optimization_manifest_url || null,
    renderer: body.renderer || null,
    generation_fingerprint: body.generation_fingerprint || null,
    qc_passed: body.qc_passed === true,
    visual_qc_passed: body.visual_qc_passed === true,
    qc_contract: body.qc_contract || null,
    grade: body.grade || null,
    score: body.score ?? null,
    authority_summary: body.authority_summary || null,
    release_evidence: body.release_evidence || null,
    blocked: body.code ? [body.code] : [],
  };
}

// Callback credentials belong only in SiteForge's server environment.  They
// are deliberately not copied from the Ghost request into the durable job
// record, where a Blob-backed worker could otherwise retain a secret.
export async function notifyGhostBuildTerminal({ job, baseUrl, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const { url, token } = callbackConfig(env);
  if (!url || !token) return { sent: false, reason: "callback_not_configured" };

  let callbackUrl;
  try {
    callbackUrl = new URL(url);
  } catch {
    return { sent: false, reason: "callback_url_invalid" };
  }
  if (callbackUrl.protocol !== "https:") return { sent: false, reason: "callback_url_not_https" };

  const contract = ghostBuildContractForJob({ baseUrl, job });
  if (![200, 422].includes(contract.statusCode)) return { sent: false, reason: "job_not_terminal" };
  const payload = terminalPayload({ ...contract, job });
  if (!payload.prospect_id) return { sent: false, reason: "callback_prospect_missing" };

  const response = await fetchImpl(callbackUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return { sent: response.ok, status: response.status, reason: response.ok ? "sent" : "callback_rejected" };
}

// Blob writes are durable but can be briefly stale immediately after the worker
// records a terminal stage. Retrying only that narrow race prevents a completed
// job from depending on an open dashboard poll to reach Ghost.
export async function notifyGhostBuildTerminalWithRetry({ getJob, jobId, baseUrl, env = process.env, fetchImpl = globalThis.fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 5 } = {}) {
  let outcome = { sent: false, reason: "job_not_terminal" };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const job = await getJob(jobId);
    outcome = await notifyGhostBuildTerminal({ job, baseUrl, env, fetchImpl });
    if (outcome.sent || outcome.reason !== "job_not_terminal") return outcome;
    if (attempt + 1 < attempts) await wait(500 * (attempt + 1));
  }
  return outcome;
}
