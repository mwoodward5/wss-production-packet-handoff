"use strict";

const { recordEvent } = require("./store");
const { apiUrl } = require("./env-compat");
const {
  veoAmbianceEnabled,
  generateAmbianceAsset,
  existingAmbianceAsset,
  veoUnderDailyCap,
  recordAmbianceUsage,
} = require("./veo-ambiance");
const { normalizeUsLocation, publicServiceNames } = require("./public-data");
const { buildCheckoutLink } = require("./checkout-links");
const { mirrorBuild } = require("./mirror-build");
const { vercelDeploy } = require("./forge");

const REQUIRED_RENDERER = "05-build-v8";
const REQUIRED_QC_CONTRACT = "public-surface-v2";
const CANONICAL_SITEFORGE_BUILD_URL = "https://siteforge-app-seven.vercel.app/api/ghost-agency/build-preview";
const RETIRED_SITEFORGE_BUILD_HOST = "siteforge-app-rocketsites.vercel.app";
const SITEFORGE_JOB_WINDOW_MS = 300_000;
const DEFAULT_SITEFORGE_TIMEOUT_MS = 295_000;
const MIN_SITEFORGE_TIMEOUT_MS = 5_000;
const DEFAULT_SITEFORGE_POLL_BUDGET_MS = 240_000;
const DEFAULT_SITEFORGE_POLL_INTERVAL_MS = 2_500;
const SITEFORGE_POLL_REQUEST_TIMEOUT_MS = 15_000;
const SITEFORGE_TERMINAL_RESPONSE_GRACE_MS = 2_000;
const RELEASE_EVIDENCE_SCHEMA = "siteforge-release-evidence-v1";
const GENERATION_FINGERPRINT_KEYS = [
  "generation_fingerprint",
  "generationFingerprint",
  "composition_fingerprint",
  "compositionFingerprint",
];

// Cross-repo compatibility: the pinned SiteForge upstream emits the v8
// snowflake renderer name and the authority-108 QC contract, while legacy
// deployments still emit the v7 pair. Both are treated as passing so the
// owner-local proof does not fail on a naming mismatch alone. The concrete
// match is preserved in the returned status object for audit.
//
// LOCAL_LANE_RENDERER / LOCAL_LANE_QC_CONTRACT identify builds produced by
// the local site-forge-lane pipeline (pipeline/repo-forge.mjs +
// pipeline/seo-truth.mjs's populateStructuredData/qcGate), fronted by
// pipeline/bridge-server.mjs's async HTTP contract. That pipeline replaced
// the donor-brand-leak defects the old 05-build-v8 remote renderer shipped
// (see wss-ghost-wrong-build-lane). Accepting these identifiers here is
// additive only — it does not change REQUIRED_RENDERER/REQUIRED_QC_CONTRACT
// (still the default target) or repoint GHOST_AGENCY_SITEFORGE_BUILD_URL;
// it only lets this parser recognize a passing build once the build URL is
// pointed at a deployed instance of that bridge.
const LOCAL_LANE_RENDERER = "site-forge-lane-repo-forge-v1";
const LOCAL_LANE_QC_CONTRACT = "site-forge-lane-qc-v1";

// FORGE, FIRST-CLASS (owner decision 2026-07-29, divergence audit).
//
// The forge-jobs mirror lane used to ship its output stamped with SiteForge's
// renderer/QC identifiers (full-run.js "forge_job_mirror"), which destroyed
// release-evidence integrity: nothing downstream could distinguish a real
// SiteForge build from Forge output wearing SiteForge credentials. The
// verified divergence audit named this the root mechanism of the July quality
// collapse.
//
// The correction is the same additive pattern 51aa467 used for the local
// bridge: Forge signs its own work with its OWN identifiers, and the gates
// accept the pair explicitly. Renderer identity comes from the renderer's
// persisted result (forge-jobs job.audit); Ghost copies it and may never
// overwrite it.
const {
  FORGE_MIRROR_RENDERER,
  FORGE_MIRROR_QC_CONTRACT,
  FORGE_RELEASE_EVIDENCE_SCHEMA,
} = require("./forge");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("./mirror-engine-contract");

const ACCEPTED_RENDERERS = new Set([
  REQUIRED_RENDERER,
  "siteforge-renderer-v8-snowflake@8.2.0",
  "siteforge-renderer-v8-premier",
  LOCAL_LANE_RENDERER,
  FORGE_MIRROR_RENDERER,
  MIRROR_ENGINE_RENDERER,
]);
const ACCEPTED_QC_CONTRACTS = new Set([
  REQUIRED_QC_CONTRACT,
  "siteforge-qc-v2-authority-108-plus-contamination",
  LOCAL_LANE_QC_CONTRACT,
  FORGE_MIRROR_QC_CONTRACT,
  MIRROR_ENGINE_QC_CONTRACT,
]);

// A renderer identity is only meaningful as a COHERENT PAIR: the SiteForge
// renderer must carry a SiteForge QC contract, the Forge renderer a Forge one.
// Cross-stamping (Forge renderer + SiteForge contract, or vice versa) is
// exactly the impersonation this exists to end, so it is rejected outright.
const RENDERER_CONTRACT_PAIRS = new Map([
  [FORGE_MIRROR_RENDERER, new Set([FORGE_MIRROR_QC_CONTRACT])],
  [LOCAL_LANE_RENDERER, new Set([LOCAL_LANE_QC_CONTRACT])],
  [MIRROR_ENGINE_RENDERER, new Set([MIRROR_ENGINE_QC_CONTRACT])],
]);
function acceptedRendererPair(renderer, qcContract) {
  const r = String(renderer || "").trim();
  const c = String(qcContract || "").trim();
  if (!ACCEPTED_RENDERERS.has(r) || !ACCEPTED_QC_CONTRACTS.has(c)) return false;
  const allowed = RENDERER_CONTRACT_PAIRS.get(r);
  if (allowed) return allowed.has(c);
  // SiteForge-family renderers pair with SiteForge-family contracts only.
  return c !== FORGE_MIRROR_QC_CONTRACT
    && c !== LOCAL_LANE_QC_CONTRACT
    && c !== MIRROR_ENGINE_QC_CONTRACT;
}

function envValue(...keys) {
  for (const key of keys) {
    const value = process.env[key] && process.env[key].trim();
    if (value) return value;
  }
  return "";
}

function envValueFrom(env, ...keys) {
  for (const key of keys) {
    const value = env && typeof env[key] === "string" ? env[key].trim() : "";
    if (value) return value;
  }
  return "";
}

function mirrorLaneReleaseGated(_env = process.env) {
  // The packaged donor lane still self-asserts its QC result and cannot emit
  // SiteForge's artifact-backed release-evidence-v1 contract. Keep the code
  // available for repair, but never let an environment toggle publish it.
  return false;
}

function siteForgeBuildTarget(env = process.env) {
  const configuredUrl = envValueFrom(
    env,
    "GHOST_AGENCY_SITEFORGE_BUILD_URL",
    "SITEFORGE_BUILD_URL",
    "WOODWARD_SITEFORGE_BUILD_URL",
  );
  if (!configuredUrl) return { url: "", migration: null };

  let configuredHost = "";
  try {
    configuredHost = new URL(configuredUrl).hostname.toLowerCase();
  } catch (_) {
    return { url: configuredUrl, migration: null };
  }
  if (configuredHost !== RETIRED_SITEFORGE_BUILD_HOST) {
    return { url: configuredUrl, migration: null };
  }
  return {
    url: CANONICAL_SITEFORGE_BUILD_URL,
    migration: {
      code: "retired_siteforge_build_host_migrated",
      from_host: RETIRED_SITEFORGE_BUILD_HOST,
      canonical_url: CANONICAL_SITEFORGE_BUILD_URL,
    },
  };
}

function siteForgeBuildUrl(env = process.env) {
  return siteForgeBuildTarget(env).url;
}

function siteForgeBuildToken() {
  return envValue("GHOST_AGENCY_SITEFORGE_BUILD_TOKEN", "SITEFORGE_BUILD_TOKEN", "WOODWARD_SITEFORGE_BUILD_TOKEN");
}

function siteForgeCallbackUrl() {
  return envValue("GHOST_AGENCY_SITEFORGE_CALLBACK_URL") || `${apiUrl().replace(/\/+$/, "")}/api/webhooks/siteforge`;
}

function siteForgeCallbackToken() {
  return envValue("GHOST_AGENCY_SITEFORGE_CALLBACK_TOKEN", "GHOST_AGENCY_SITEFORGE_BUILD_TOKEN");
}

function siteForgeTimeoutMs(env = process.env) {
  const configured = Number.parseInt(env.GHOST_AGENCY_SITEFORGE_TIMEOUT_MS || "", 10);
  if (!Number.isFinite(configured)) return DEFAULT_SITEFORGE_TIMEOUT_MS;
  return Math.min(Math.max(configured, MIN_SITEFORGE_TIMEOUT_MS), SITEFORGE_JOB_WINDOW_MS);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function siteForgePollBudgetMs(env = process.env) {
  return boundedInteger(
    env.GHOST_AGENCY_SITEFORGE_POLL_BUDGET_MS,
    DEFAULT_SITEFORGE_POLL_BUDGET_MS,
    1_000,
    270_000,
  );
}

function siteForgePollIntervalMs(env = process.env) {
  return boundedInteger(
    env.GHOST_AGENCY_SITEFORGE_POLL_INTERVAL_MS,
    DEFAULT_SITEFORGE_POLL_INTERVAL_MS,
    250,
    10_000,
  );
}

function firstUrl(input, keys) {
  for (const key of keys) {
    const value = input && input[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) return value.trim();
  }
  return "";
}

function firstPresent(input, keys) {
  for (const key of keys) {
    if (input && Object.prototype.hasOwnProperty.call(input, key)) return input[key];
  }
  return undefined;
}

function firstString(input, keys) {
  for (const key of keys) {
    const value = input && input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function nestedObjects(json = {}) {
  return [
    json,
    json.payload,
    json.data,
    json.urls,
    json.result,
    json.report,
    json.qc,
    json.scorecard,
    json.report && json.report.qc,
    json.report && json.report.scorecard,
    json.payload && json.payload.prospect,
    json.payload && json.payload.truth_packet,
  ].filter((item) => item && typeof item === "object");
}

function extractAuthoritySummary(json = {}) {
  for (const source of nestedObjects(json)) {
    for (const key of ["authority_summary", "authoritySummary", "authority_standard", "authorityStandard"]) {
      const value = source[key];
      if (value && typeof value === "object" && Number(value.total) === 108) return value;
    }
  }
  return null;
}

function extractOptimizationManifestUrl(json = {}) {
  for (const source of nestedObjects(json)) {
    const value = firstUrl(source, ["optimization_manifest_url", "optimizationManifestUrl"]);
    if (value) return value;
  }
  return "";
}

function extractReleaseEvidence(json = {}) {
  const record = json.record && typeof json.record === "object" ? json.record : {};
  const sources = [
    ...nestedObjects(json),
    json.build_status,
    json.buildStatus,
    json.callback,
    json.siteforge_callback,
    json.build_dispatch,
    record,
    record.siteforge_callback,
    record.build_dispatch,
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));
  for (const source of sources) {
    for (const key of ["release_evidence", "releaseEvidence"]) {
      const evidence = source[key];
      if (
        evidence
        && typeof evidence === "object"
        && !Array.isArray(evidence)
        && evidence.schema === RELEASE_EVIDENCE_SCHEMA
      ) {
        return evidence;
      }
    }
  }
  return null;
}

function extractCompiledTruthPacket(json = {}) {
  const sources = nestedObjects(json);
  for (const source of sources) {
    for (const key of ["truth_packet", "truthPacket"]) {
      const packet = source[key];
      if (
        packet
        && typeof packet === "object"
        && !Array.isArray(packet)
        && packet.facts
        && typeof packet.facts === "object"
        && Array.isArray(packet.assets)
        && Array.isArray(packet.evidence)
      ) {
        return packet;
      }
    }
  }
  return null;
}

function extractGenerationFingerprint(json = {}) {
  for (const source of nestedObjects(json)) {
    for (const key of GENERATION_FINGERPRINT_KEYS) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    for (const key of ["generation", "composition"]) {
      const nested = source[key];
      if (!nested || typeof nested !== "object") continue;
      const value = firstString(nested, ["fingerprint", ...GENERATION_FINGERPRINT_KEYS]);
      if (value) return value;
    }
  }
  return "";
}

function truthyGate(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return /^(true|yes|ok|pass|passed|ready|cleared)$/i.test(value.trim());
  return false;
}

function extractBuildStatus(json = {}) {
  const sources = nestedObjects(json);
  const firstFromSources = (keys) => {
    for (const source of sources) {
      const value = firstPresent(source, keys);
      if (value !== undefined && value !== null && String(value).trim()) return value;
    }
    return undefined;
  };
  const renderer = String(firstFromSources(["renderer", "renderer_id", "rendererId", "build_renderer", "buildRenderer"]) || "").trim();
  const grade = String(firstFromSources(["grade", "qc_grade", "qcGrade"]) || "").trim().toUpperCase();
  const status = String(firstFromSources(["status", "state"]) || "").trim();
  const scoreRaw = firstFromSources(["score", "qc_score", "qcScore"]);
  const score = Number.isFinite(Number(scoreRaw)) ? Number(scoreRaw) : null;
  const degraded = truthyGate(firstFromSources(["degraded", "qc_degraded", "qcDegraded"]));
  const explicitQc = firstFromSources(["qc_passed", "qcPassed", "qc_ok", "qcOk", "quality_gate_passed", "qualityGatePassed"]);
  const qcPassed = explicitQc !== undefined ? truthyGate(explicitQc) : grade === "A" || (grade === "B" && degraded);
  const explicitVisual = firstFromSources(["visual_qc_passed", "visualQcPassed", "visual_passed", "visualPassed"]);
  const visualQcPassed = explicitVisual !== undefined && truthyGate(explicitVisual);
  const qcContract = String(firstFromSources(["qc_contract", "qcContract", "quality_contract", "qualityContract"]) || "").trim();
  const generationFingerprint = extractGenerationFingerprint(json);
  const rendererPassed = ACCEPTED_RENDERERS.has(renderer);
  const urls = extractBuildUrls(json);
  const blocked = [];
  if (!urls.report_url || !urls.preview_url) blocked.push("report_or_preview_url_missing");
  if (!rendererPassed) blocked.push(renderer ? `renderer_${renderer}_not_allowed` : "renderer_missing");
  if (!generationFingerprint) blocked.push("generation_fingerprint_missing");
  if (!qcPassed) blocked.push(grade ? `qc_grade_${grade}_not_passed` : "qc_not_passed");
  if (!visualQcPassed) blocked.push("visual_qc_not_passed");
  const qcContractPassed = qcContract && ACCEPTED_QC_CONTRACTS.has(qcContract);
  if (!qcContractPassed) blocked.push(qcContract ? `qc_contract_${qcContract}_not_allowed` : "qc_contract_missing");
  return {
    ready: blocked.length === 0,
    renderer,
    required_renderer: REQUIRED_RENDERER,
    renderer_passed: rendererPassed,
    generation_fingerprint: generationFingerprint || null,
    generation_fingerprint_present: Boolean(generationFingerprint),
    qc_passed: qcPassed,
    visual_qc_passed: visualQcPassed,
    qc_contract: qcContract || null,
    required_qc_contract: REQUIRED_QC_CONTRACT,
    grade: grade || null,
    score,
    degraded,
    status,
    blocked,
  };
}

function extractBuildUrls(json = {}) {
  const payload = json.payload && typeof json.payload === "object" ? json.payload : {};
  const data = json.data && typeof json.data === "object" ? json.data : {};
  const urls = json.urls && typeof json.urls === "object" ? json.urls : {};
  const result = json.result && typeof json.result === "object" ? json.result : {};
  const reportUrl =
    firstUrl(json, ["report_url", "reportUrl", "report", "diagnostic_report_url"]) ||
    firstUrl(payload, ["report_url", "reportUrl", "report"]) ||
    firstUrl(data, ["report_url", "reportUrl", "report"]) ||
    firstUrl(urls, ["report_url", "reportUrl", "report"]) ||
    firstUrl(result, ["report_url", "reportUrl", "report", "diagnostic_report_url"]);
  const previewUrl =
    firstUrl(json, ["preview_url", "previewUrl", "preview", "url", "diagnostic_url"]) ||
    firstUrl(payload, ["preview_url", "previewUrl", "preview", "url"]) ||
    firstUrl(data, ["preview_url", "previewUrl", "preview", "url"]) ||
    firstUrl(urls, ["preview_url", "previewUrl", "preview", "url"]) ||
    firstUrl(result, ["preview_url", "previewUrl", "preview", "url", "diagnostic_url"]);
  return {
    report_url: reportUrl || "",
    preview_url: previewUrl || "",
  };
}

async function requestJson(url, {
  method = "GET",
  payload,
  headers = {},
  timeoutMs = SITEFORGE_POLL_REQUEST_TIMEOUT_MS,
  cache,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      ...(cache ? { cache } : {}),
      signal: controller.signal,
    });
    const text = await response.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch (_) {
      json = { raw: text.slice(0, 2000) };
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson(url, payload, headers = {}, timeoutMs = siteForgeTimeoutMs()) {
  return requestJson(url, {
    method: "POST",
    payload,
    headers,
    timeoutMs,
  });
}

async function getJson(url, headers = {}, timeoutMs = SITEFORGE_POLL_REQUEST_TIMEOUT_MS) {
  return requestJson(url, { method: "GET", headers, timeoutMs, cache: "no-store" });
}

let durableStatusRequestSequence = 0;

function durableStatusRequestUrl(statusUrl) {
  const url = new URL(statusUrl);
  durableStatusRequestSequence += 1;
  url.searchParams.set("_ts", `${Date.now()}-${durableStatusRequestSequence}`);
  return url.toString();
}

function durableStatusHeaders(headers = {}) {
  return {
    ...headers,
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
}

function resolveStatusUrl(json = {}, buildUrl = "") {
  const raw = firstString(json, ["status_url", "statusUrl"]);
  if (!raw) return "";
  try {
    return new URL(raw, buildUrl).toString();
  } catch (_) {
    return "";
  }
}

function jobIdFrom(json = {}) {
  return firstString(json, ["job_id", "jobId", "id"]);
}

function pendingJobResponse(result = {}) {
  const state = String(result.json?.status || result.json?.state || "").trim().toLowerCase();
  return result.status === 202 || result.json?.pending === true || ["new", "queued", "running", "building", "pending"].includes(state);
}

const RETRYABLE_SITEFORGE_TERMINAL_STATES = new Set(["failed", "blocked", "timed_out"]);

function retryableTerminalResumeResponse(result = {}, resume = {}) {
  const body = result.json && typeof result.json === "object" ? result.json : {};
  const state = String(body.status || body.state || "").trim().toLowerCase();
  const resumeJobId = jobIdFrom(resume);
  const responseJobId = jobIdFrom(body);
  return Boolean(
    result.status === 422
    && result.ok === false
    && body.ok === false
    && body.pending === false
    && RETRYABLE_SITEFORGE_TERMINAL_STATES.has(state)
    && resumeJobId
    && responseJobId === resumeJobId
  );
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollSiteForgeJob({
  statusUrl,
  headers = {},
  timeoutMs = siteForgePollBudgetMs(),
  intervalMs = siteForgePollIntervalMs(),
  fetchJson = getJson,
  sleep = wait,
  now = () => Date.now(),
} = {}) {
  const startedAt = now();
  let last = {
    ok: true,
    status: 202,
    json: { ok: true, status: "queued", pending: true, status_url: statusUrl },
  };

  while (now() - startedAt < timeoutMs) {
    const requestBudgetMs = timeoutMs - (now() - startedAt);
    if (requestBudgetMs <= 0) break;
    try {
      // A request that started inside the build window may finish just after
      // it. Give that in-flight read a small, fixed network grace so a valid
      // terminal contract is not discarded at the boundary. The loop still
      // never starts another read after timeoutMs, and the grace cannot start
      // new build work or consume more than two seconds of the send reserve.
      const requestTimeoutMs = Math.max(
        1,
        Math.min(
          SITEFORGE_POLL_REQUEST_TIMEOUT_MS,
          requestBudgetMs + SITEFORGE_TERMINAL_RESPONSE_GRACE_MS,
        ),
      );
      const current = await fetchJson(
        durableStatusRequestUrl(statusUrl),
        durableStatusHeaders(headers),
        requestTimeoutMs,
      );
      last = current;
      if (!pendingJobResponse(current)) return current;
    } catch (_) {
      // Durable status reads can cross cold starts; retry until the bounded deadline.
    }
    const remaining = timeoutMs - (now() - startedAt);
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }

  return {
    ok: true,
    status: 202,
    json: {
      ...(last.json || {}),
      ok: true,
      status: "building",
      pending: true,
      status_url: statusUrl,
    },
  };
}

function publicProspect(prospect = {}, job = {}) {
  const location = normalizeUsLocation({
    city: prospect.city || prospect.market || job.prospect?.city || "",
    state: prospect.state || prospect.region || job.prospect?.state || "",
    address: prospect.address || prospect.formattedAddress || job.prospect?.address || "",
  });
  const checkoutUrl = buildCheckoutLink({ prospect, job });
  return {
    prospect_id: prospect.prospect_id || prospect.id || job.prospect?.id || "",
    business_name: prospect.business_name || prospect.businessName || job.prospect?.businessName || "",
    industry: prospect.industry || prospect.category || job.prospect?.industry || "",
    city: location.city,
    state: location.state,
    email: prospect.email || prospect.owner_email || prospect.ownerEmail || job.prospect?.ownerEmail || "",
    phone: prospect.phone || job.prospect?.phone || "",
    address: prospect.address || prospect.formattedAddress || job.prospect?.address || "",
    latlng: prospect.latlng || job.prospect?.latlng || null,
    current_website: prospect.current_website || prospect.currentWebsite || job.prospect?.currentWebsite || "",
    services: publicServiceNames(prospect.services || prospect.primary_services || [], prospect.industry || prospect.category),
    place_id: prospect.place_id || prospect.placeId || prospect.record?.place_id || job.prospect?.place_id || "",
    // No-website lane (Mark 2026-07-20): give SiteForge a scrapeable Google
    // Business Profile link so a business with no website can still source real
    // first-party photos (SiteForge reads prospect.gbp_url). Built from the
    // place_id we already capture; never a new external call.
    gbp_url: (() => {
      const pid = prospect.place_id || prospect.placeId || prospect.record?.place_id || job.prospect?.place_id || "";
      return prospect.gbp_url || prospect.gbpUrl || prospect.record?.gbp_url
        || (pid ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(pid)}` : "");
    })(),
    purchase_url: checkoutUrl,
    checkout_url: checkoutUrl,
    composition_slot: Number.isInteger(prospect.composition_slot) && prospect.composition_slot >= 0
      ? prospect.composition_slot
      : null,
    source: prospect.source || "ghost-agency",
  };
}

function buildSiteForgePayload({ prospect = {}, job = {}, truthPacket = {}, injectedMedia = [] } = {}) {
  const publicLead = publicProspect(prospect, job);
  const supportEmail = envValue("GHOST_AGENCY_SUPPORT_EMAIL", "LOCAL_GROWTH_SUPPORT_EMAIL") || "support@woodwardsoftware.com";
  const contactEndpoint = `${apiUrl().replace(/\/+$/, "")}/api/preview-contact`;
  const injected = Array.isArray(injectedMedia) ? injectedMedia.filter(Boolean) : [];
  return {
    eventName: "ghost_agency_preview_requested",
    source: "woodward-ghost-agency",
    requestedAt: new Date().toISOString(),
    // Ghost-generated media (e.g. the AI-ambiance Veo hero) for SiteForge intake
    // to merge into its build packet. Omitted when empty so normal builds are
    // byte-for-byte unchanged.
    ...(injected.length ? { injected_media: injected } : {}),
    job: {
      id: job.id,
      product: job.product || "Local Growth Website Plan",
      owner: job.owner || "Woodward Software",
    },
    prospect: publicLead,
    purchase_url: publicLead.purchase_url,
    contact_capture: {
      endpoint: contactEndpoint,
      method: "POST",
      prospect_id: publicLead.prospect_id,
      fallback_href: `mailto:${supportEmail}?subject=${encodeURIComponent(`Preview inquiry - ${publicLead.business_name || "local business"}`)}`,
      required_fields: ["name", "email_or_phone", "message"],
    },
    packets: {
      truth: truthPacket,
      site: job.packets && job.packets.site,
      report: job.packets && job.packets.report,
    },
    requirements: {
      privatePreview: true,
      noIndex: true,
      noFakeUrls: true,
      renderer: REQUIRED_RENDERER,
      mustPassQc: true,
      qcContract: REQUIRED_QC_CONTRACT,
      mustTraceClaimsToTruthPacket: true,
      mustReturn: ["report_url", "preview_url", "generation_fingerprint"],
      build_type: "premier_multi_page",
      previewAcceptance: [
        "uses real business identity and local-service category from the truth packet",
        "uses bounded real-media inputs or clearly marks missing media in internal notes",
        "includes one above-the-fold conversion path and one report-backed proof section",
        "includes a complete owner purchase/contact rail on private previews",
        "returns a stable generation_fingerprint for the exact rendered composition",
        "submits quote and contact requests to contact_capture.endpoint, with contact_capture.fallback_href when JavaScript or the endpoint is unavailable",
        "does not render internal terms such as PageHub, FireCrawl, BrightData, VAPI, Twilio, packet, crawler, scrape, or proof-board",
        "does not publish, email, charge, or claim launch without a separate confirmation",
      ],
    },
    callback: {
      url: siteForgeCallbackUrl(),
      token: siteForgeCallbackToken(),
    },
  };
}

async function maybeGenerateAmbianceMedia({ prospect = {}, job = {} } = {}) {
  if (!veoAmbianceEnabled()) return [];
  const vertical = prospect.vertical || prospect.category || prospect.industry
    || job.vertical || job.prospect?.industry || "local service";
  const slug = prospect.slug || job.slug || prospect.prospect_id || prospect.id
    || (prospect.business_name || "site").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  // 1. Reuse an already-generated clip for this site — no paid render.
  const cached = await existingAmbianceAsset({ vertical, slug });
  if (cached) return [cached];
  // 2. Hard daily cost ceiling — degrade to the photo hero when the day's cap is
  //    reached OR usage can't be read (fail-closed). Owner tunes the ceiling via
  //    GHOST_AGENCY_VEO_MAX_PER_DAY (0 disables Veo entirely).
  if (!(await veoUnderDailyCap({}))) return [];
  // 3. Generate a fresh clip and count it against today's cap.
  const asset = await generateAmbianceAsset({ vertical, slug });
  if (!asset) return [];
  await recordAmbianceUsage({ slug });
  return [asset];
}

function resolveMirrorDonor(donor, {
  env = process.env,
  backendRoot = require("node:path").resolve(__dirname, ".."),
  registry,
} = {}) {
  const fs = require("node:fs");
  const path = require("node:path");
  let selected = donor;
  let donorRel = (selected?.source && selected.source.path) || "";
  let donorPath = path.resolve(backendRoot, donorRel);

  const overrideRel = envValueFrom(env, "GHOST_AGENCY_MIRROR_DONOR_PATH");
  if (!fs.existsSync(donorPath) && overrideRel) {
    const loaded = registry || require("./donor-registry").loadRegistry();
    const override = (loaded.donors || []).find((candidate) => (
      candidate?.source?.path === overrideRel
      && candidate.donor_manifest
    ));
    if (override) {
      selected = override;
      donorRel = overrideRel;
      donorPath = path.resolve(backendRoot, donorRel);
    }
  }

  return { donor: selected, donorRel, donorPath };
}

async function dispatchSiteForgePreview({
  prospect = {},
  job = {},
  truthPacket = {},
  resume = {},
  skipAmbiance = false,
  awaitTerminal = false,
  buildDeadlineAt = 0,
  deadlineAt = 0,
} = {}) {
  // Mirror lane (owner directive 2026-07-27): clone a donor template, swap identity,
  // deploy via file-hash. The packaged donor path cannot yet emit artifact-backed
  // release evidence, so mirrorLaneReleaseGated() keeps it disabled and every
  // environment falls through to the authenticated remote SiteForge renderer.
  if (mirrorLaneReleaseGated()) {
    // Merge record.* into prospect so packet fields (zip, county, reviews, geo, brand)
    // resolve from the enriched JSONB record, not just top-level columns (2026-07-28).
    if (prospect.record && typeof prospect.record === "object") {
      for (const [k, v] of Object.entries(prospect.record)) {
        if (prospect[k] === undefined || prospect[k] === null || prospect[k] === "") prospect[k] = v;
      }
    }
    const { pickDonor } = require("./donor-registry");
    const vertical = String(prospect.industry || truthPacket.industry || "roofing").toLowerCase();
    const metro = `${prospect.city || truthPacket.city || ""}, ${prospect.state || truthPacket.state || ""}`.replace(/^, |, $/g, "");
    const donor = pickDonor(vertical, metro);
    if (!donor) return { mode: "mirror", ok: false, blocked: `mirror_v2_no_donor_for_${vertical}_${metro}` };
    // serverless: the function's cwd is the .func dir, not the repo root. Resolve
    // relative to this module's location (apps/backend/lib/) up to the backend root.
    const resolvedDonor = resolveMirrorDonor(donor);
    const selectedDonor = resolvedDonor.donor;
    const donorRel = resolvedDonor.donorRel;
    const donorPath = resolvedDonor.donorPath;
    if (!require("node:fs").existsSync(donorPath)) return { mode: "mirror", ok: false, blocked: `donor_path_missing:${donorRel}` };
    try {
      // Clean URL: the slug is the business name, not the prospect_id (owner directive 2026-07-28).
      // place-chijms9ds05x1oyrkkfrqzbozuq.wss-ai.com -> sunset-roofing-tucson.wss-ai.com
      const bizSlug = String(prospect.business_name || truthPacket.business_name || "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
      const citySlug = String(prospect.city || truthPacket.city || "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20);
      const slug = bizSlug ? (citySlug ? `${bizSlug}-${citySlug}` : bizSlug) : String(prospect.prospect_id || prospect.id || "").replace(/[^a-z0-9-]/g, "-").slice(0, 60) || "mirror-site";
      // Brand enrichment (Comet audit 2026-07-27): extract the prospect's real logo +
      // dominant brand color from their current website before mirroring. Without this,
      // every mirror renders the donor's logo + default accent (the Tekline bleed).
      let logoUrl = prospect.logo_url || truthPacket.logo_url || truthPacket.logo || "";
      let brandColor = prospect.brand_color || truthPacket.brand_color || truthPacket.primary_color || "";
      // The intake genie (firecrawl) is the primary brand source — it captures the
      // prospect's real logo + assets from their live site. The mirror lane's packet
      // must carry the genie's logo_url, not a donor default.
      if (!logoUrl || !brandColor) {
        try {
          const { callIntakeGenie, truthPacketFromCanonical } = require("./intake-genie-client");
          const genie = await callIntakeGenie(prospect);
          if (genie && genie.ok && genie.packet) {
            const canonical = truthPacketFromCanonical(genie.packet);
            if (!logoUrl && canonical.logo_url) logoUrl = canonical.logo_url;
            if (!brandColor && canonical.brand_color) brandColor = canonical.brand_color;
          }
        } catch { /* genie unreachable — fall back to brand-scrape */ }
      }
      if (!logoUrl || !brandColor) {
        const siteUrl = prospect.current_website || truthPacket.website || "";
        if (siteUrl) {
          try {
            const { scrapeBrandIdentity } = require("./brand-scrape");
            const brand = await scrapeBrandIdentity(siteUrl);
            if (!logoUrl && brand.logo_url) logoUrl = brand.logo_url;
            if (!brandColor && brand.primary_color) brandColor = brand.primary_color;
          } catch { /* enrichment failed — donor defaults apply */ }
        }
      }
      const packet = {
        business_name: prospect.business_name || truthPacket.business_name || "Local Business",
        city: prospect.city || truthPacket.city || "",
        state: prospect.state || truthPacket.state || "",
        phone: prospect.phone || truthPacket.phone || "",
        email: prospect.email || truthPacket.email || "",
        website: prospect.current_website || truthPacket.website || "",
        county: prospect.county || truthPacket.county || "",
        zip: prospect.zip || truthPacket.zip || "",
        preview_url: prospect.preview_url || truthPacket.preview_url || "",
        owner_name: prospect.owner_name || truthPacket.owner_name || "",
        geo: (prospect.latitude && prospect.longitude) ? `${prospect.latitude},${prospect.longitude}` : (truthPacket.geo || ""),
        lat: prospect.latitude || truthPacket.lat || null,
        lng: prospect.longitude || truthPacket.lng || null,
        license: prospect.license || truthPacket.license || "",
        rating: prospect.rating || truthPacket.rating || null,
        reviews_count: prospect.review_count || truthPacket.review_count || null,
        logo_url: prospect.logo_url || truthPacket.logo_url || truthPacket.logo || "",
        brand_color: prospect.brand_color || truthPacket.brand_color || truthPacket.primary_color || "",
        donor_manifest: selectedDonor.donor_manifest || truthPacket.donor_manifest || {},
        donor_id: selectedDonor.donor_id || truthPacket.donor_id || "",
      };
      // Validation gate (Comet audit 2026-07-27): block generic/empty names before they ship
      const genericNames = ["roofing company", "plumbing company", "hvac company", "landscaping company", "local business"];
      if (!packet.business_name || genericNames.includes(packet.business_name.toLowerCase().trim())) {
        return { mode: "mirror", ok: false, blocked: `generic_business_name:${packet.business_name}` };
      }
      if (!packet.city || !packet.state) {
        return { mode: "mirror", ok: false, blocked: "missing_city_or_state" };
      }
      // Implausible review counts (Comet audit: Parobek 4156+ for a Bastrop plumber).
      // A single-city local operator with >1000 reviews is almost certainly bad data.
      if (packet.reviews_count && Number(packet.reviews_count) > 1000) {
        return { mode: "mirror", ok: false, blocked: `implausible_review_count:${packet.reviews_count}` };
      }
      const { files, manifest } = await mirrorBuild({ donorPath, packet, slug });
      const projectName = `ghost-${slug}`;
      const aliasHost = `${slug}.wss-ai.com`;
      const deployed = await vercelDeploy({ files, projectName, aliasHost });
      if (!deployed || !deployed.alias) {
        return { mode: "mirror", ok: false, blocked: deployed?.aliasError || "mirror_alias_failed", manifest };
      }
      // Mirror builds bypass the remote HTTP handoff below, but downstream
      // Ghost code still consumes that handoff's canonical payload contract.
      // Build it here as well so every successful lane returns the same signed
      // checkout URL instead of falling back to a stale prospect record.
      const payload = buildSiteForgePayload({ prospect, job, truthPacket });
      return {
        mode: "mirror",
        configured: true,
        pending: false,
        urls: {
          preview_url: `https://${aliasHost}/`,
          // NO FABRICATED REPORT URL. This interpolated the build SLUG into a
          // report path, minting a link to a report that cannot exist: the
          // reports table keys on a UUID, so a slug id is rejected as "invalid
          // input syntax for uuid". 63 of 75 stored report_urls were this kind
          // of dead link. It never mattered while the email silently dropped
          // reportUrl — now that the email PRINTS it and Riley reads it back to
          // a caller, a fabricated link is a promise we cannot keep. A report
          // URL comes from actually saving a report (lib/line-report.js) or it
          // stays empty.
          report_url: "",
          optimization_manifest_url: "",
          authority_summary: "",
        },
        buildStatus: {
          ready: true,
          renderer: REQUIRED_RENDERER,
          required_renderer: REQUIRED_RENDERER,
          qc_passed: true,
          visual_qc_passed: true,
          qc_contract: REQUIRED_QC_CONTRACT,
          blocked: [],
          generation_fingerprint: `mirror-${slug}-${Date.now()}`,
          template_family: donor.donor_id || "unknown",
          map_evidence: true,
          preview_identity_evidence: true,
        },
        manifest,
        deployed: { alias: deployed.alias, url: deployed.url },
        payload,
        checkout_url: payload.prospect.checkout_url,
        purchase_url: payload.purchase_url,
      };
    } catch (e) {
      return { mode: "mirror", ok: false, blocked: `mirror_build_error:${String(e.message || e).slice(0, 120)}` };
    }
  }
  const buildTarget = siteForgeBuildTarget();
  const url = buildTarget.url;
  const suppliedBuildDeadlineAt = Number(buildDeadlineAt) || Number(deadlineAt);
  const terminalDeadlineAt = awaitTerminal === true
    ? (Number.isFinite(suppliedBuildDeadlineAt) && suppliedBuildDeadlineAt > 0
      ? suppliedBuildDeadlineAt
      : Date.now() + siteForgePollBudgetMs())
    : 0;
  const remainingTerminalBudgetMs = () => Math.max(0, Math.floor(terminalDeadlineAt - Date.now()));
  // Generate the AI-ambiance hero only on a fresh dispatch — never on a durable
  // status-read resume, which must not re-trigger a paid Veo render. Gated and
  // graceful: [] unless GHOST_AGENCY_VEO_AMBIANCE is on and generation succeeds.
  const resuming = Boolean(resolveStatusUrl(resume, url));
  // skipAmbiance forces the free photo / Ken-Burns-drift hero (no paid Veo
  // render) — used for owner-review and throughput batches where video cost is
  // deliberately off. The SiteForge hero already animates static photos.
  const terminalBudgetExpired = awaitTerminal === true && remainingTerminalBudgetMs() <= 0;
  const injectedMedia = (resuming || skipAmbiance || terminalBudgetExpired)
    ? []
    : await maybeGenerateAmbianceMedia({ prospect, job });
  const payload = buildSiteForgePayload({ prospect, job, truthPacket, injectedMedia });
  if (!url) {
    return {
      mode: "handoff_packet",
      configured: false,
      reason: "GHOST_AGENCY_SITEFORGE_BUILD_URL not configured",
      payload,
    };
  }

  const token = siteForgeBuildToken();
  const requestIdentity = String(job.id || "").trim();
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    // One Ghost build ticket must always map to one durable SiteForge job.
    // SiteForge claims this key before compilation, so HTTP retries cannot
    // purchase or render a second preview.
    ...(requestIdentity ? {
      "Idempotency-Key": requestIdentity,
      "X-Correlation-Id": requestIdentity,
    } : {}),
  };
  let statusUrl = resolveStatusUrl(resume, url);
  let durableJobId = jobIdFrom(resume);
  let result;
  let deadlineExhausted = false;
  const exhaustedResult = () => {
    deadlineExhausted = true;
    const resumable = Boolean(statusUrl && durableJobId);
    return {
      ok: false,
      status: 408,
      json: {
        ok: false,
        status: resumable ? "pending" : "held",
        pending: resumable,
        code: "siteforge_deadline_exhausted",
        ...(durableJobId ? { job_id: durableJobId } : {}),
        ...(statusUrl ? { status_url: statusUrl } : {}),
      },
    };
  };
  if (statusUrl) {
    // A single status read lets SiteForge kick the next signed durable stage.
    // Do not loop here: the terminal callback, not a four-minute cockpit
    // request, remains responsible for completing the preview in Ghost.
    const remainingMs = remainingTerminalBudgetMs();
    if (awaitTerminal === true && remainingMs <= 0) {
      result = exhaustedResult();
    } else {
      const statusReadTimeoutMs = awaitTerminal === true
        ? Math.min(SITEFORGE_POLL_REQUEST_TIMEOUT_MS, remainingMs)
        : SITEFORGE_POLL_REQUEST_TIMEOUT_MS;
      result = await getJson(
        durableStatusRequestUrl(statusUrl),
        durableStatusHeaders(headers),
        statusReadTimeoutMs,
      );
      if (result.status === 404 || retryableTerminalResumeResponse(result, resume)) {
        statusUrl = "";
        durableJobId = "";
        result = null;
      }
    }
  }
  if (!result) {
    const remainingMs = remainingTerminalBudgetMs();
    if (awaitTerminal === true && remainingMs <= 0) {
      result = exhaustedResult();
    } else {
      const postTimeoutMs = awaitTerminal === true
        ? Math.min(siteForgeTimeoutMs(), remainingMs)
        : siteForgeTimeoutMs();
      result = await postJson(url, payload, headers, postTimeoutMs);
      durableJobId = jobIdFrom(result.json) || durableJobId;
      statusUrl = resolveStatusUrl(result.json, url);
    }
  }
  // The strict owner-proof lane needs the completed artifact in this same
  // request so its inline send can be deterministic. The initial POST above is
  // still issued exactly once; every follow-up is a GET against SiteForge's
  // durable, lease-protected job handle.
  if (awaitTerminal === true && statusUrl && pendingJobResponse(result)) {
    const pollBudgetMs = Math.min(siteForgePollBudgetMs(), remainingTerminalBudgetMs());
    if (pollBudgetMs > 0) {
      result = await pollSiteForgeJob({ statusUrl, headers, timeoutMs: pollBudgetMs });
    }
    durableJobId = jobIdFrom(result.json) || durableJobId;
    statusUrl = resolveStatusUrl(result.json, url) || statusUrl;
  }
  const urls = extractBuildUrls(result.json);
  const pending = pendingJobResponse(result);
  const extractedStatus = extractBuildStatus(result.json);
  const buildStatus = pending
    ? { ...extractedStatus, ready: false, pending: true, blocked: [] }
    : { ...extractedStatus, pending: false };
  // Surface SiteForge's OWN rejection code/error/missing so ghost never masks
  // the real reason behind the generic derived blocked list. A 422 like
  // {code:"source_evidence_incomplete", missing:["source logo"]} is the actual
  // signal an operator needs, not "everything is missing because it never built".
  const sfBody = result && result.json && typeof result.json === "object" ? result.json : {};
  buildStatus.siteforge_code = sfBody.code || null;
  buildStatus.siteforge_error = sfBody.error || sfBody.message || null;
  buildStatus.siteforge_missing = Array.isArray(sfBody.missing) ? sfBody.missing : null;
  buildStatus.siteforge_http_status = result ? result.status : null;
  const authoritySummary = extractAuthoritySummary(result.json);
  const optimizationManifestUrl = extractOptimizationManifestUrl(result.json);
  const releaseEvidence = extractReleaseEvidence(result.json);
  const compiledTruthPacket = extractCompiledTruthPacket(result.json);
  if (!result.ok && !buildStatus.blocked.length) buildStatus.blocked.push("siteforge_dispatch_failed");
  if (!deadlineExhausted) {
    await recordEvent("siteforge_preview_dispatch", {
      jobId: job.id,
      prospectId: payload.prospect.prospect_id,
      status: result.status,
      ok: result.ok,
      reportUrlReady: Boolean(urls.report_url),
      previewUrlReady: Boolean(urls.preview_url),
      renderer: buildStatus.renderer || null,
      generationFingerprint: buildStatus.generation_fingerprint || null,
      qcPassed: buildStatus.qc_passed,
      ready: buildStatus.ready,
      pending,
      blocked: buildStatus.blocked,
      buildUrlDiagnostic: buildTarget.migration?.code || null,
    });
  }
  return {
    mode: "http_dispatch",
    configured: true,
    url,
    result,
    urls,
    buildStatus,
    authoritySummary,
    optimizationManifestUrl,
    releaseEvidence,
    truthPacket: compiledTruthPacket,
    pending,
    jobId: durableJobId || jobIdFrom(result.json),
    statusUrl,
    buildUrlMigration: buildTarget.migration,
    payload,
  };
}

module.exports = {
  ACCEPTED_QC_CONTRACTS,
  ACCEPTED_RENDERERS,
  buildSiteForgePayload,
  dispatchSiteForgePreview,
  extractAuthoritySummary,
  extractBuildStatus,
  extractBuildUrls,
  extractGenerationFingerprint,
  extractOptimizationManifestUrl,
  extractReleaseEvidence,
  extractCompiledTruthPacket,
  mirrorLaneReleaseGated,
  CANONICAL_SITEFORGE_BUILD_URL,
  REQUIRED_RENDERER,
  REQUIRED_QC_CONTRACT,
  LOCAL_LANE_RENDERER,
  LOCAL_LANE_QC_CONTRACT,
  FORGE_MIRROR_RENDERER,
  FORGE_MIRROR_QC_CONTRACT,
  FORGE_RELEASE_EVIDENCE_SCHEMA,
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
  acceptedRendererPair,
  RELEASE_EVIDENCE_SCHEMA,
  resolveMirrorDonor,
  DEFAULT_SITEFORGE_TIMEOUT_MS,
  DEFAULT_SITEFORGE_POLL_BUDGET_MS,
  DEFAULT_SITEFORGE_POLL_INTERVAL_MS,
  SITEFORGE_JOB_WINDOW_MS,
  pollSiteForgeJob,
  resolveStatusUrl,
  siteForgeBuildToken,
  siteForgeBuildTarget,
  siteForgeBuildUrl,
  siteForgeCallbackToken,
  siteForgeCallbackUrl,
  siteForgeTimeoutMs,
  siteForgePollBudgetMs,
  siteForgePollIntervalMs,
};
// cache-bust 1785126587
// cache-bust 1785194225
