"use strict";

// A deleted website is a durable retirement, never a disappearing row.  The
// tombstone keeps the stable identity, hostname, and suppression decision so a
// stale queue worker or a future miner cannot silently recreate it.

const { retireLegacyProject } = require("./mirror-engine/deploy");
const { recordFleetRetirement } = require("./mirror-fleet-identity");
const { purgeArchivedSiteSource } = require("./site-source-archive");

const RETIRING = "retiring";
const RETIRED = "retired";

function text(value) { return String(value == null ? "" : value).trim(); }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function legacySlug(value) { return /^wss-test-[a-z0-9-]+$/.test(text(value).toLowerCase()) ? text(value).toLowerCase() : ""; }

function identityFor(row = {}) {
  const record = object(row.record);
  const forge = object(record.forge_job);
  const input = object(forge.input);
  const slug = legacySlug(record.site_slug || row.site_slug || row.prospect_id || record.prospect_id);
  const projectName = text(record.preview_project_name || input.project_name || record.project_name || slug).toLowerCase();
  return {
    prospectId: text(row.prospect_id || record.prospect_id),
    slug,
    projectName,
    hostname: slug ? `${slug}.wss-ai.com` : "",
    sharedSiteId: text(record.shared_site_id || record.sharedSiteId),
  };
}

function retirementRecord(row, { now = new Date(), reason = "operator_delete" } = {}) {
  const identity = identityFor(row);
  return {
    state: RETIRING,
    requested_at: now.toISOString(),
    reason: text(reason).slice(0, 160) || "operator_delete",
    prospect_id: identity.prospectId,
    slug: identity.slug,
    hostname: identity.hostname,
    project_name: identity.projectName,
    suppression: true,
  };
}

async function retireSharedHost(identity) {
  if (!identity?.sharedSiteId) return { ok: true, skipped: true };
  const base = text(process.env.SUPABASE_URL).replace(/\/+$/, "");
  const key = text(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!base || !key || !identity.hostname) return { ok: false, reason: "shared_host_retirement_not_configured" };
  try {
    const response = await fetch(`${base}/rest/v1/rpc/retire_site_host`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_normalized_host: identity.hostname, p_site_id: identity.sharedSiteId }),
    });
    const body = await response.json().catch(() => ({}));
    return response.ok && body?.ok === true
      ? { ok: true, retired: true }
      : { ok: false, reason: text(body?.reason || `shared_host_retirement_http_${response.status}`) };
  } catch (error) {
    return { ok: false, reason: text(error?.message || error).slice(0, 180) };
  }
}

async function executeRetirement(row, {
  now = () => new Date(),
  teardownProject = retireLegacyProject,
  purgeSource = purgeArchivedSiteSource,
  retireFleet = recordFleetRetirement,
  retireSharedHost: retireShared = retireSharedHost,
} = {}) {
  const identity = identityFor(row);
  if (!identity.prospectId || !identity.slug || identity.projectName !== identity.slug) {
    return { ok: false, state: RETIRING, reason: "legacy_site_identity_unproven", identity };
  }
  try {
    const project = await teardownProject({ projectName: identity.projectName, slug: identity.slug });
    if (!project?.ok) return { ok: false, state: RETIRING, reason: "vercel_teardown_failed", identity, project };
    const source = await purgeSource(identity.slug);
    if (!source?.ok) return { ok: false, state: RETIRING, reason: "artifact_purge_failed", identity, project, source };
    const fleet = await retireFleet({ slug: identity.slug, reason: "operator_delete" });
    if (!fleet?.ok) return { ok: false, state: RETIRING, reason: "fleet_tombstone_failed", identity, project, source, fleet };
    const shared = await retireShared(identity);
    if (!shared?.ok) return { ok: false, state: RETIRING, reason: "shared_host_retirement_failed", identity, project, source, fleet, shared };
    return {
      ok: true,
      state: RETIRED,
      identity,
      receipt: { completed_at: now().toISOString(), project, source, fleet, shared },
    };
  } catch (error) {
    return { ok: false, state: RETIRING, reason: "retirement_exception", detail: String(error?.message || error).slice(0, 180), identity };
  }
}

module.exports = { RETIRING, RETIRED, identityFor, retirementRecord, retireSharedHost, executeRetirement };
