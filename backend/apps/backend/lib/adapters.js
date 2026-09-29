const { buildWoodwardLabsBuildTicketPayload } = require("./packets");
const { SYSTEMS } = require("./registry");
const { recordEvent } = require("./store");

async function postJson(url, payload, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      json,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function dispatchZapier(job, eventName = "ghost_agency_job_created") {
  const url = process.env.ZAPIER_GHOST_AGENCY_HOOK_URL?.trim();
  if (!url) {
    return {
      mode: "intentionally_disabled",
      configured: false,
      eventName,
      required: false,
      launchReadiness: "excluded",
      reason: "Native signed checkout webhook and direct adapters own fulfillment; Zapier is optional and excluded from launch readiness.",
    };
  }
  const result = await postJson(url, { eventName, job });
  await recordEvent("zapier_dispatch", { eventName, jobId: job.id, result });
  return {
    mode: "webhook_dispatch",
    configured: true,
    eventName,
    result,
  };
}

function zapierStatus(env = process.env) {
  const configured = Boolean(String(env.ZAPIER_GHOST_AGENCY_HOOK_URL || "").trim());
  return configured
    ? { mode: "enabled_optional_adapter", configured: true, required: false, launchReadiness: "not_blocking" }
    : { mode: "intentionally_disabled", configured: false, required: false, launchReadiness: "excluded" };
}

function woodwardLabsBuildTicketUrl() {
  return process.env.WOODWARD_LABS_BUILD_TICKET_URL?.trim() || "";
}

function woodwardLabsBuildTicketToken() {
  return process.env.WOODWARD_LABS_BUILD_TICKET_TOKEN?.trim() || "";
}

async function dispatchWoodwardLabsBuildTicket(job) {
  const payload = buildWoodwardLabsBuildTicketPayload(job);
  const url = woodwardLabsBuildTicketUrl();
  if (!url) {
    return {
      mode: "handoff_packet",
      configured: false,
      reason:
        "WOODWARD_LABS_BUILD_TICKET_URL not configured",
      recommendedTargets: [SYSTEMS.woodwardLabs.url, SYSTEMS.dreamForge.url],
      payload,
    };
  }
  const token = woodwardLabsBuildTicketToken();
  if (!token) {
    return {
      mode: "configuration_blocked",
      configured: false,
      reason:
        "WOODWARD_LABS_BUILD_TICKET_TOKEN not configured",
      recommendedTargets: [SYSTEMS.woodwardLabs.url, SYSTEMS.dreamForge.url],
      payload,
    };
  }
  const result = await postJson(url, payload, {
    Authorization: `Bearer ${token}`,
  });
  await recordEvent("woodward_labs_build_ticket_dispatch", { jobId: job.id, result });
  return {
    mode: "http_dispatch",
    configured: true,
    url,
    result,
    payload,
  };
}

function leadminerAdapter(job) {
  return {
    mode: "deep_link",
    configured: true,
    system: SYSTEMS.leadminer,
    expectedOutput: "CSV/XLSX export or masked preview rows scored by market and intent.",
    query: {
      industry: job.prospect.industry,
      city: job.prospect.city,
      state: job.prospect.state,
    },
  };
}

function callprepAdapter(job) {
  return {
    mode: "report_packet",
    configured: true,
    system: SYSTEMS.callprep,
    packet: job.packets.report,
    expectedOutput: "local footprint report card, SERP gaps, AI visibility notes, and buyer-safe summary.",
  };
}

module.exports = {
  callprepAdapter,
  dispatchRocketBuildTicket: dispatchWoodwardLabsBuildTicket,
  dispatchWoodwardLabsBuildTicket,
  dispatchZapier,
  leadminerAdapter,
  postJson,
  zapierStatus,
};
