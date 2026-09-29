"use strict";

const AGENTS = [
  ["agent_00_orchestrator","Orchestrator","routes work across the pipeline"],
  ["agent_01_prospect_miner","Prospect Miner","harvests businesses (Google Places)"],
  ["agent_02_enrichment","Enrichment","finds public emails + signals"],
  ["agent_03_report","Report","builds the CallPrep/SERP report"],
  ["agent_04_packet_compiler","Packet Compiler","assembles the build packet"],
  ["agent_05_site_builder","Site Builder","generates the preview site"],
  ["agent_06_qc_gatekeeper","QC Gatekeeper","grades quality before send"],
  ["agent_07_consent_registrar","Consent Registrar","logs call/text consent (TCPA)"],
  ["agent_08_billing","Billing","Stripe checkout + webhook"],
  ["agent_09_delivery_domain","Delivery/Domain","email domain + deliverability"],
  ["agent_10_support_edits","Support & Edits","post-sale edit requests"],
  ["agent_11_retention","Retention","renewals + retention"],
  ["agent_12_media_video","Media/Video","hero media + video"],
  ["agent_13_email_sequencer","Email Sequencer","runs the drip cadence"],
];
const EVENT_STATES = new Set(["received", "started", "dependency-wait", "progress", "completed", "failed", "retry"]);

function telemetryPayload(actor, lifecycle, details = {}) {
  if (!actor || !EVENT_STATES.has(lifecycle)) throw new Error("agent_telemetry_invalid");
  return {
    ...details,
    actor,
    telemetry: lifecycle,
    status: lifecycle === "failed" ? "failed" : (lifecycle === "dependency-wait" ? "blocked" : lifecycle),
  };
}

function telemetryState(events) {
  if (!events.length) return "never-invoked";
  const latest = events[0];
  const payload = latest.payload || {};
  if (payload.disabled === true || payload.status === "disabled") return "disabled";
  const kind = String(payload.telemetry || payload.lifecycle || payload.status || latest.type || "").toLowerCase();
  if (/fail|error/.test(kind)) return "failed";
  if (/dependency-wait|blocked|waiting/.test(kind)) return "blocked";
  if (/completed|success|healthy|ok/.test(kind)) return "healthy";
  return "idle";
}
function agentTelemetry(events = [], definitions = AGENTS) {
  return definitions.map(([id, name, role]) => {
    const matching = events.filter((event) => event && event.payload && event.payload.actor === id);
    const successes = matching.filter((event) => /completed|success/.test(String(event.payload.telemetry || event.payload.lifecycle || event.payload.status || event.type).toLowerCase()));
    const errors = matching.filter((event) => /failed|error/.test(String(event.payload.telemetry || event.payload.lifecycle || event.payload.status || event.type).toLowerCase()));
    const latest = matching[0];
    const payload = latest && latest.payload || {};
    const lifecycle = EVENT_STATES.has(payload.telemetry) ? payload.telemetry : (EVENT_STATES.has(payload.lifecycle) ? payload.lifecycle : null);
    const state = telemetryState(matching);
    return {
      id, name, role,
      state,
      status: state,
      lifecycle,
      lastRun: latest ? latest.created_at : null,
      lastType: latest ? latest.type : null,
      lastSuccess: successes[0] ? successes[0].created_at : null,
      lastError: errors[0] ? { at: errors[0].created_at, code: errors[0].payload.code || errors[0].payload.reason || errors[0].type } : null,
      activeJob: payload.jobId || payload.job_id || payload.runId || payload.run_id || null,
      nextDependency: payload.nextDependency || payload.next_dependency || payload.dependency || null,
    };
  });
}

module.exports = { AGENTS, EVENT_STATES, agentTelemetry, telemetryPayload, telemetryState };
