"use strict";

// Honest volume preflight: "100 requested" is not the same as "100 sendable".
// This reports, for a candidate set of prospects, how many actually clear
// every gate lib/email.js sendSequenceStep would apply on a real send - so an
// operator sees the realistic number BEFORE firing a batch, not after.
//
// Candidate set is one of:
//   - an explicit prospectIds list (e.g. the held-drafts set)
//   - a category + location filter (a hypothetical full-run mining target)
//   - (default) the current active supervised_10_review_pending held batch
//
// This module only reads. It never stages, approves, or sends anything.

const { deliveryPauseStatus } = require("./delivery-pause");
const { outreachFromStatus } = require("./env-compat");
const {
  emailConfigured,
  reviewHoldActive,
  resendWebhookConfigured,
  suppressionBlocked,
} = require("./email");
const { outreachDnsStatus } = require("./outreach-dns");
const { emailLogExists } = require("./full-run");
const { firstValue } = require("./prospects");
const { prospectSendsEnabled } = require("./send-policy");
const { DRAFT_COUNT, HOLD_KEY } = require("./supervised-held-drafts");
const { select } = require("./store");

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function clampLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(number), 1), MAX_LIMIT);
}

function stripWildcards(value) {
  return String(value || "").trim().replace(/\*/g, "");
}

async function defaultLoadByProspectIds(ids = []) {
  if (!ids.length) return { ok: true, rows: [] };
  const filter = ids.map((id) => encodeURIComponent(id)).join(",");
  const result = await select("ghost_agency_prospects", `?select=*&prospect_id=in.(${filter})`);
  if (!result.ok || !Array.isArray(result.data)) return { ok: false, rows: [] };
  return { ok: true, rows: result.data };
}

async function defaultLoadByCategoryLocation({ category = "", location = "", limit = DEFAULT_LIMIT } = {}) {
  const clauses = ["select=*", "order=updated_at.desc", `limit=${limit}`];
  if (category) clauses.push(`industry=ilike.*${encodeURIComponent(category)}*`);
  if (location) clauses.push(`city=ilike.*${encodeURIComponent(location)}*`);
  const result = await select("ghost_agency_prospects", `?${clauses.join("&")}`);
  if (!result.ok || !Array.isArray(result.data)) return { ok: false, rows: [] };
  return { ok: true, rows: result.data };
}

async function defaultLoadHeldBatch(loadByProspectIds) {
  const drafts = await select(
    "ghost_agency_outbound_review_drafts",
    `?select=prospect_id&hold_key=eq.${encodeURIComponent(HOLD_KEY)}&order=created_at.asc&limit=${DRAFT_COUNT + 1}`,
  );
  if (!drafts.ok || !Array.isArray(drafts.data)) return { ok: false, rows: [] };
  const ids = [...new Set(drafts.data.map((row) => String(row.prospect_id || "").trim()).filter(Boolean))];
  return loadByProspectIds(ids);
}

async function perProspectGates(row, deps) {
  const prospectIdValue = String(firstValue(row, ["prospect_id", "id"]) || "").trim();
  const email = String(firstValue(row, ["email", "owner_email", "ownerEmail"]) || "").trim().toLowerCase();
  const hasEmail = Boolean(email);
  const consentReady = Boolean(prospectIdValue && hasEmail);

  let notSuppressed = true;
  if (hasEmail) {
    try {
      const suppression = await deps.suppressionBlocked(row);
      notSuppressed = suppression?.blocked === false && suppression?.unavailable !== true;
    } catch {
      notSuppressed = false;
    }
  }

  let notAlreadyContacted = true;
  if (hasEmail) {
    try {
      const duplicate = await deps.emailLogExists(row);
      notAlreadyContacted = duplicate?.exists === false;
    } catch {
      notAlreadyContacted = false;
    }
  }

  const prospectSendable = consentReady && notSuppressed && notAlreadyContacted;
  return {
    prospectId: prospectIdValue || null,
    businessName: firstValue(row, ["business_name", "businessName", "name"]) || null,
    consent_ready: consentReady,
    // Backward-compatible response key. It now means the consent-first
    // identity is ready; no site build or release artifact is required.
    built_ok: consentReady,
    has_email: hasEmail,
    not_suppressed: notSuppressed,
    not_already_contacted: notAlreadyContacted,
    prospect_sendable: prospectSendable,
    actually_sendable: false,
    failures: consentReady ? [] : ["prospect_identity_incomplete"],
  };
}

async function sendablePreflight(input = {}, dependencies = {}) {
  const deps = {
    loadByProspectIds: defaultLoadByProspectIds,
    loadByCategoryLocation: defaultLoadByCategoryLocation,
    loadHeldBatch: (loadIds) => defaultLoadHeldBatch(loadIds),
    suppressionBlocked,
    emailLogExists,
    reviewHoldActive,
    deliveryPauseStatus,
    outreachFromStatus,
    emailConfigured,
    resendWebhookConfigured,
    outreachDnsStatus,
    prospectSendsEnabled,
    postalAddressConfigured: () => Boolean(process.env.GHOST_AGENCY_POSTAL_ADDRESS?.trim()),
    unsubscribeConfigured: () => Boolean(process.env.EMAIL_UNSUB_SECRET?.trim()),
    ...dependencies,
  };

  const limit = clampLimit(input.limit);
  let source;
  let loaded;
  if (Array.isArray(input.prospectIds) && input.prospectIds.length) {
    const ids = [...new Set(input.prospectIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, MAX_LIMIT);
    source = "prospect_ids";
    loaded = await deps.loadByProspectIds(ids);
  } else if (input.category || input.location) {
    source = "category_location";
    loaded = await deps.loadByCategoryLocation({
      category: stripWildcards(input.category),
      location: stripWildcards(input.location),
      limit,
    });
  } else {
    source = "held_drafts";
    loaded = await deps.loadHeldBatch(deps.loadByProspectIds);
  }

  if (!loaded?.ok) {
    return { ok: false, blocked: "prospect_store_unavailable", source };
  }

  const rows = Array.isArray(loaded.rows) ? loaded.rows : [];
  const prospects = [];
  for (const row of rows) {
    prospects.push(await perProspectGates(row, deps));
  }

  const countOf = (key) => prospects.filter((item) => item[key]).length;

  let environment;
  try {
    const [deliveryPause, sender, dns] = await Promise.all([
      deps.deliveryPauseStatus(),
      Promise.resolve(deps.outreachFromStatus()),
      deps.outreachDnsStatus(),
    ]);
    environment = {
      reviewHoldActive: Boolean(deps.reviewHoldActive()),
      deliveryPauseActive: Boolean(deliveryPause?.active),
      senderReady: Boolean(sender?.ok),
      resendConfigured: Boolean(deps.emailConfigured("outreach")),
      webhookConfigured: Boolean(deps.resendWebhookConfigured()),
      dnsVerified: Boolean(dns?.ok),
      prospectSendsEnabled: Boolean(deps.prospectSendsEnabled()),
      postalAddressConfigured: Boolean(deps.postalAddressConfigured()),
      unsubscribeConfigured: Boolean(deps.unsubscribeConfigured()),
    };
  } catch {
    return { ok: false, blocked: "send_environment_state_unavailable", source };
  }
  environment.ready = !environment.reviewHoldActive
    && !environment.deliveryPauseActive
    && environment.senderReady
    && environment.resendConfigured
    && environment.webhookConfigured
    && environment.dnsVerified
    && environment.prospectSendsEnabled
    && environment.postalAddressConfigured
    && environment.unsubscribeConfigured;

  for (const prospect of prospects) {
    prospect.actually_sendable = prospect.prospect_sendable && environment.ready;
  }

  return {
    ok: true,
    source,
    ...(source === "held_drafts" ? { holdKey: HOLD_KEY } : {}),
    requested: prospects.length,
    consent_ready: countOf("consent_ready"),
    built_ok: countOf("built_ok"),
    has_email: countOf("has_email"),
    not_suppressed: countOf("not_suppressed"),
    not_already_contacted: countOf("not_already_contacted"),
    actually_sendable: countOf("actually_sendable"),
    environment,
    prospects,
  };
}

module.exports = {
  sendablePreflight,
};
