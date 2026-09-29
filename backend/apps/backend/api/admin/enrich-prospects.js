"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { enrichPublicContacts, normalizeEmail, normalizeUrl } = require("../../lib/contact-enrichment");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { recordEvent, select } = require("../../lib/store");

function first(row = {}, names = []) {
  const record = row.record && typeof row.record === "object" ? row.record : {};
  for (const name of names) {
    const found = row[name] ?? record[name];
    if (found !== undefined && found !== null && String(found).trim()) return found;
  }
  return "";
}

function percent(value, total) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}

function canonicalWebsiteEvidence(row = {}) {
  const record = row.record && typeof row.record === "object" ? row.record : {};
  const email = normalizeEmail(first(row, ["email", "owner_email", "ownerEmail"]));
  const website = normalizeUrl(first(row, ["current_website", "currentWebsite", "website", "website_url"]));
  if (!email || !website) return [];

  // The live miner records places_basic only after extracting an address from
  // the business's canonical website. Older imported rows without that
  // provenance stay unknown and held.
  const source = String(first(row, ["source"])).toLowerCase();
  const truthSource = String(record.truth_packet_source || "").toLowerCase();
  const enrichmentStatus = String(record.enrichment_status || "").toLowerCase();
  const websiteSourced = source === "places-live-mine"
    || truthSource === "places_basic"
    || enrichmentStatus === "email_found";
  if (!websiteSourced) return [];

  const verification = record.email_verification && typeof record.email_verification === "object"
    ? record.email_verification
    : undefined;
  return [{
    source_type: "business_website",
    url: website,
    observed_at: first(row, ["updated_at", "created_at"]) || null,
    contacts: [{ kind: "email", value: email, ...(verification ? { verification } : {}) }],
  }];
}

function summarize(rows = []) {
  const results = rows.map((row) => enrichPublicContacts(row, canonicalWebsiteEvidence(row)));
  const rawRows = rows.filter((row) => normalizeEmail(first(row, ["email", "owner_email", "ownerEmail"])));
  const topLevelRows = rows.filter((row) => normalizeEmail(row.email || row.owner_email));
  const evidenceContacts = results.flatMap((result) => result.contacts.filter((contact) => contact.kind === "email"));
  const verified = evidenceContacts.filter((contact) => contact.verified_reachable);
  const sendable = evidenceContacts.filter((contact) => contact.sendable);
  const highConfidence = evidenceContacts.filter((contact) => contact.confidence === "high");
  const unknown = Math.max(0, rawRows.length - evidenceContacts.length);
  const total = rows.length;

  return {
    totalProspects: total,
    before: {
      topLevelAddressCount: topLevelRows.length,
      effectiveRawAddressCount: rawRows.length,
      effectiveRawAddressRate: percent(rawRows.length, total),
      verifiedReachableCount: 0,
      verifiedReachableRate: 0,
    },
    after: {
      publicEvidenceCount: evidenceContacts.length,
      highConfidenceCount: highConfidence.length,
      verifiedReachableCount: verified.length,
      verifiedReachableRate: percent(verified.length, total),
      sendableCount: sendable.length,
      heldCount: rawRows.length - sendable.length,
    },
    sourceBreakdown: {
      businessWebsite: evidenceContacts.length,
      unknownUnverified: unknown,
    },
    confidenceBreakdown: {
      high: highConfidence.length,
      medium: evidenceContacts.filter((contact) => contact.confidence === "medium").length,
      low: evidenceContacts.filter((contact) => contact.confidence === "low").length,
      unknown,
    },
    policy: "Only explicitly verified, high-confidence contacts become sendable; every other address remains held.",
  };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const found = await select("ghost_agency_prospects", "?select=*&order=updated_at.desc&limit=500");
    if (!found.ok || !Array.isArray(found.data)) {
      sendJson(res, 503, { ok: false, error: "prospect_store_unavailable" });
      return;
    }
    const report = summarize(found.data);
    await recordEvent("enrichment.public_source.audit", {
      actor: "admin_enrichment_pass",
      status: "complete",
      totalProspects: report.totalProspects,
      before: report.before,
      after: report.after,
      sourceBreakdown: report.sourceBreakdown,
      confidenceBreakdown: report.confidenceBreakdown,
    });
    sendJson(res, 200, { ok: true, mode: "public_source_evidence_audit", ...report });
  } catch (error) {
    handleError(res, error);
  }
};

module.exports.canonicalWebsiteEvidence = canonicalWebsiteEvidence;
module.exports.summarize = summarize;
