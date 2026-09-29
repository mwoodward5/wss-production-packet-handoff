"use strict";

const { requireCron } = require("../../lib/cron-auth");
const { methodGuard, sendJson } = require("../../lib/http");
const { conditionalUpdate, select } = require("../../lib/store");

const MAX_PURGES_PER_RUN = 100;
const RETENTION_POLICY = "fixed_14_day_vapi_build_retention";
const ARTIFACT_PAYLOAD_KEYS = Object.freeze(["analysis", "artifact", "recording", "transcript"]);

function dryRun(req) {
  const url = new URL(req.url || "/", "https://ghost-agency.invalid");
  return ["true", "1", "yes"].includes(String(url.searchParams.get("dry_run") || "").toLowerCase());
}

function hasArtifacts(row = {}) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return Boolean(
    row.recording_url ||
    row.transcript ||
    row.summary ||
    payload.analysis ||
    payload.artifact ||
    payload.recording ||
    payload.transcript,
  );
}

function retainedPayload(row = {}, now = new Date().toISOString()) {
  const original = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload
    : {};
  const payload = { ...original };
  for (const key of ARTIFACT_PAYLOAD_KEYS) delete payload[key];
  payload.retention_purged_at = now;
  payload.retention_policy = RETENTION_POLICY;
  payload.artifact_retention_expires_at = row.artifact_retention_expires_at || null;
  return payload;
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireCron(req, res)) return;

  const now = new Date().toISOString();
  const isDryRun = dryRun(req);
  const expired = await select(
    "mission_control_customer_calls",
    `?select=id,account_id,vapi_call_id,status,duration_seconds,recording_url,transcript,summary,payload,recording_consent_enabled,recording_consent_mode,artifact_retention_expires_at&artifact_retention_expires_at=lte.${encodeURIComponent(now)}&limit=${MAX_PURGES_PER_RUN}`,
  );
  if (!expired.ok) {
    sendJson(res, 200, {
      ok: false,
      mode: expired.mode === "dry_run" ? "no_op" : "schema_blocked",
      job: "customer-call-artifact-retention",
      scanned: 0,
      purged: 0,
      reason: expired.skipped || expired.error || "Retention table/query unavailable",
    });
    return;
  }

  const rows = Array.isArray(expired.data) ? expired.data.filter(hasArtifacts).slice(0, MAX_PURGES_PER_RUN) : [];
  const results = [];
  for (const row of rows) {
    if (isDryRun) {
      results.push({ id: row.id, call_id: row.vapi_call_id, mode: "would_purge" });
      continue;
    }

    // This is an UPDATE, not an UPSERT. mission_control_customer_calls has
    // required account_id/agent_id columns, so a partial upsert can be treated
    // as an insert before conflict resolution and fail with Postgres 23502.
    // Guard the expiry value too: if another process extends retention after
    // this row was selected, the purge loses the race instead of deleting data.
    const updated = await conditionalUpdate(
      "mission_control_customer_calls",
      "id",
      row.id,
      { artifact_retention_expires_at: `eq.${row.artifact_retention_expires_at}` },
      {
        summary: null,
        transcript: null,
        recording_url: null,
        payload: retainedPayload(row, now),
        updated_at: now,
      },
    );
    const purged = updated.ok === true && updated.updated === true;
    results.push({
      id: row.id,
      call_id: row.vapi_call_id,
      mode: purged ? "purged" : "purge_failed",
      error: purged ? undefined : updated.error || updated.mode || "retention_update_race_lost",
    });
  }

  const failures = results.filter((row) => row.mode === "purge_failed");
  sendJson(res, failures.length ? 502 : 200, {
    ok: failures.length === 0,
    mode: isDryRun ? "dry_run" : rows.length ? "purged" : "no_op",
    job: "customer-call-artifact-retention",
    scanned: rows.length,
    purged: results.filter((row) => row.mode === "purged").length,
    bounded: true,
    max_per_run: MAX_PURGES_PER_RUN,
    results,
  });
};

module.exports._test = { ARTIFACT_PAYLOAD_KEYS, hasArtifacts, retainedPayload };
