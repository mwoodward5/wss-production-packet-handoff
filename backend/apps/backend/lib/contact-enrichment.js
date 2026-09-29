"use strict";

const SOURCE_POLICY = Object.freeze({
  website: { confidence: 0.8, label: "Owned website" },
  gbp: { confidence: 0.88, label: "Google Business Profile" },
  facebook: { confidence: 0.65, label: "Facebook" },
  instagram: { confidence: 0.6, label: "Instagram" },
  public_directory: { confidence: 0.55, label: "Public directory" }
});

const LEGACY_SOURCE_ALIASES = Object.freeze({
  google_business_profile: "gbp",
  google_places: "gbp",
  directory: "public_directory"
});

function clean(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

const ENCODED_LEADING_WHITESPACE = /^(?:%(?:09|0a|0b|0c|0d|20|a0))+/i;
const JUNK_EMAIL_FILE_SUFFIX = /\.(?:png|jpe?g|gif|webp|svg|css|js)$/i;
const REJECTED_EMAIL_DOMAIN_LABELS = new Set([
  // Keep the send-time policy aligned with lead-miner's existing junk and
  // platform filters. These are crawler, telemetry, platform, or placeholder
  // domains — never a business recipient address.
  "sentry",
  "wixpress",
  "schema",
  "godaddy",
  "wordpress",
  "wix",
  "squarespace",
  "shopify",
  "google",
  "gstatic",
  "cloudflare",
]);

function stripLeadingEncodedWhitespace(value) {
  let text = String(value || "").trim();
  // Decode only an explicitly whitespace-only prefix. Do not decode the rest
  // of the local part, where percent is otherwise valid, and never throw on a
  // malformed escape sequence from stale imported data.
  for (let index = 0; index < 3; index += 1) {
    const match = text.match(ENCODED_LEADING_WHITESPACE);
    if (!match) break;
    try {
      if (!/^[\s\u00a0]+$/.test(decodeURIComponent(match[0]))) break;
    } catch {
      break;
    }
    text = text.slice(match[0].length).trimStart();
  }
  return text;
}

function rejectedEmailDomain(domain) {
  const labels = String(domain || "").toLowerCase().split(".").filter(Boolean);
  return labels.some((label) => REJECTED_EMAIL_DOMAIN_LABELS.has(label) || /^sentry(?:[-_]|$)/.test(label));
}

function normalizeEmail(value) {
  const email = stripLeadingEncodedWhitespace(
    clean(value, 320).replace(/^mailto:/i, ""),
  ).toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) return "";
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (JUNK_EMAIL_FILE_SUFFIX.test(email) || rejectedEmailDomain(domain)) return "";
  return email;
}

function normalizePhone(value) {
  const raw = clean(value, 80).replace(/^tel:/i, "");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return "";
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function normalizeSourceName(value) {
  const source = clean(value, 80).toLowerCase().replace(/[\s-]+/g, "_");
  return LEGACY_SOURCE_ALIASES[source] || source;
}

function asRows(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function asValues(row, singular, plural) {
  return [...asRows(row[plural]), ...asRows(row[singular])];
}

function explicitReachability(row, kind) {
  const value = row[`${kind}_reachable`] ?? row.reachable;
  if (value === true || value === false) return value;
  const status = clean(row[`${kind}_status`] || row.reachability_status || row.status, 80).toLowerCase();
  if (["reachable", "verified", "deliverable", "valid"].includes(status)) return true;
  if (["unreachable", "undeliverable", "invalid", "bounced"].includes(status)) return false;
  return null;
}

function evidenceConfidence(source, row) {
  const explicit = Number(row.confidence);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(1, explicit));
  if (row.verified === true) return Math.max(SOURCE_POLICY[source].confidence, 0.95);
  return SOURCE_POLICY[source].confidence;
}

function contactRole(row) {
  const role = clean(row.contact_role || row.role, 80).toLowerCase();
  return ["owner", "founder", "proprietor"].includes(role) ? "owner" : (role || "unknown");
}

function collectEvidence(sources, observedAt) {
  const evidence = [];
  for (const [inputName, value] of Object.entries(sources || {})) {
    const source = normalizeSourceName(inputName);
    if (!SOURCE_POLICY[source]) continue;
    for (const row of asRows(value)) {
      if (!row || typeof row !== "object") continue;
      const common = {
        source,
        source_label: SOURCE_POLICY[source].label,
        source_url: clean(row.source_url || row.url, 1000) || null,
        observed_at: clean(row.observed_at, 80) || observedAt,
        confidence: evidenceConfidence(source, row),
        contact_role: contactRole(row),
        contact_name: clean(row.contact_name || row.owner_name, 200) || null
      };
      for (const raw of asValues(row, "email", "emails")) {
        const email = normalizeEmail(typeof raw === "object" ? raw.value : raw);
        if (!email) continue;
        const detail = typeof raw === "object" ? raw : row;
        evidence.push({ ...common, kind: "email", value: email, reachable: explicitReachability(detail, "email"), suppressed: detail.suppressed === true });
      }
      for (const raw of asValues(row, "phone", "phones")) {
        const phone = normalizePhone(typeof raw === "object" ? raw.value : raw);
        if (!phone) continue;
        const detail = typeof raw === "object" ? raw : row;
        evidence.push({ ...common, kind: "phone", value: phone, reachable: explicitReachability(detail, "phone"), suppressed: detail.suppressed === true });
      }
    }
  }
  return evidence;
}

function mergeEvidence(evidence) {
  const merged = new Map();
  for (const item of evidence) {
    const key = `${item.kind}:${item.value}`;
    const current = merged.get(key) || {
      kind: item.kind,
      value: item.value,
      confidence: 0,
      reachable: null,
      suppressed: false,
      contact_role: "unknown",
      contact_name: null,
      provenance: []
    };
    current.confidence = Math.max(current.confidence, item.confidence);
    if (item.reachable === true) current.reachable = true;
    else if (item.reachable === false && current.reachable !== true) current.reachable = false;
    current.suppressed ||= item.suppressed;
    if (item.contact_role === "owner") {
      current.contact_role = "owner";
      current.contact_name = item.contact_name || current.contact_name;
    }
    current.provenance.push({
      source: item.source,
      source_label: item.source_label,
      source_url: item.source_url,
      observed_at: item.observed_at,
      confidence: item.confidence
    });
    merged.set(key, current);
  }
  return [...merged.values()].map((item) => ({
    ...item,
    sendable: item.kind === "email" && item.reachable === true && item.confidence >= 0.75 && !item.suppressed
  })).sort((a, b) => Number(b.sendable) - Number(a.sendable) || b.confidence - a.confidence);
}

function uniqueReasons(values) {
  return [...new Set(values.filter(Boolean))];
}

function enrichContactEvidence(input = {}) {
  const observedAt = clean(input.observed_at, 80) || new Date().toISOString();
  const evidence = collectEvidence(input.sources, observedAt);
  const contacts = mergeEvidence(evidence);
  const emails = contacts.filter((row) => row.kind === "email");
  const phones = contacts.filter((row) => row.kind === "phone");
  const bestEmail = emails[0] || null;
  const bestPhone = phones[0] || null;
  const holdReasons = [];

  if (!contacts.length) holdReasons.push("no_contact_evidence");
  if (emails.length > 1) holdReasons.push("email_conflict_review_required");
  if (bestEmail && bestEmail.reachable === null) holdReasons.push("email_reachability_unverified");
  if (bestEmail && bestEmail.reachable === false) holdReasons.push("email_unreachable");
  if (bestEmail && bestEmail.confidence < 0.75) holdReasons.push("email_confidence_below_threshold");
  if (bestEmail && bestEmail.suppressed) holdReasons.push("email_suppressed");
  if (bestEmail && bestEmail.contact_role !== "owner") holdReasons.push("owner_identity_unverified");

  const reasons = uniqueReasons(holdReasons);
  const ownerEmail = bestEmail && bestEmail.sendable && bestEmail.contact_role === "owner" ? bestEmail.value : null;

  return {
    schema_version: "contact-enrichment.v1",
    observed_at: observedAt,
    contacts,
    recommended_fields: {
      email: bestEmail ? bestEmail.value : null,
      phone: bestPhone ? bestPhone.value : null,
      owner_email: ownerEmail,
      owner_name: ownerEmail ? bestEmail.contact_name : null
    },
    outreach: {
      review_hold: reasons.length > 0,
      hold_reasons: reasons,
      sendable_email: bestEmail && bestEmail.sendable ? bestEmail.value : null
    },
    counters: {
      evidence_observations: evidence.length,
      unique_contacts: contacts.length,
      email_addresses_found: emails.length,
      emails_reachability_verified: emails.filter((row) => row.reachable !== null).length,
      emails_reachable: emails.filter((row) => row.reachable === true).length,
      emails_sendable: emails.filter((row) => row.sendable).length,
      phone_numbers_found: phones.length,
      sources_checked: Object.keys(input.sources || {}).filter((source) => SOURCE_POLICY[normalizeSourceName(source)]).length
    }
  };
}

// This module is deliberately a classifier, not an outreach client. Callers
// supply evidence collected from public pages; this file never fetches pages or
// sends email, calls, or SMS.

const PUBLIC_SOURCE_TYPES = Object.freeze([
  "business_website",
  "google_business_profile",
  "facebook",
  "instagram",
  "directory",
]);

const PUBLIC_SOURCE_ALIASES = Object.freeze({
  website: "business_website",
  business: "business_website",
  business_site: "business_website",
  gbp: "google_business_profile",
  google: "google_business_profile",
  google_business: "google_business_profile",
  google_business_profile: "google_business_profile",
  facebook: "facebook",
  instagram: "instagram",
  directory: "directory",
  directories: "directory",
});

function normalizeSourceType(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return PUBLIC_SOURCE_ALIASES[key] || (PUBLIC_SOURCE_TYPES.includes(key) ? key : null);
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function hostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeContact(kind, value) {
  if (String(kind || "").toLowerCase() === "email") return normalizeEmail(value);
  if (String(kind || "").toLowerCase() === "phone") return normalizePhone(value);
  return null;
}

function contactKind(value, fallback) {
  const kind = String(fallback || value?.kind || value?.type || "").toLowerCase();
  if (kind === "email" || kind === "phone") return kind;
  const raw = typeof value === "object" ? value.value || value.contact : value;
  return String(raw || "").includes("@") ? "email" : "phone";
}

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function contactsFromSource(source) {
  const explicit = asArray(source.contacts).map((item) => (typeof item === "object" ? item : { value: item }));
  const emails = asArray(source.email || source.emails).map((value) => ({ kind: "email", value }));
  const phones = asArray(source.phone || source.phones).map((value) => ({ kind: "phone", value }));
  return [...explicit, ...emails, ...phones];
}

function isVerifiedReachable(contact = {}) {
  const verification = contact.verification || contact.reachability;
  if (!verification || typeof verification !== "object") return false;
  const checkedAt = verification.checked_at || verification.checkedAt;
  const method = String(verification.method || "").trim();
  return verification.status === "verified" && Boolean(checkedAt) && Boolean(method);
}

function confidenceFor(sourceType, sourceUrl, businessWebsite) {
  if (sourceType === "business_website") {
    // A claimed "business website" must actually be the prospect's site when
    // that canonical website is known. We never promote a lookalike domain.
    if (!businessWebsite || hostname(sourceUrl) === hostname(businessWebsite)) return "high";
    return "low";
  }
  if (sourceType === "directory") return "low";
  return "medium";
}

function sourceEvidence(source, contact, businessWebsite) {
  const sourceType = normalizeSourceType(source.source_type || source.sourceType || source.type);
  const sourceUrl = normalizeUrl(source.url || source.source_url || source.sourceUrl);
  if (!sourceType || !sourceUrl) return null;

  const kind = contactKind(contact);
  const raw = typeof contact === "object" ? contact.value || contact.contact : contact;
  const value = normalizeContact(kind, raw);
  if (!value) return null;

  const verification = contact.verification || contact.reachability || null;
  return {
    kind,
    value,
    confidence: confidenceFor(sourceType, sourceUrl, businessWebsite),
    verified_reachable: isVerifiedReachable(contact),
    evidence: {
      source_type: sourceType,
      url: sourceUrl,
      observed_at: contact.observed_at || contact.observedAt || source.observed_at || source.observedAt || null,
      locator: contact.locator || contact.field || null,
      verification: verification
        ? {
            status: verification.status || null,
            method: verification.method || null,
            checked_at: verification.checked_at || verification.checkedAt || null,
          }
        : null,
    },
  };
}

const CONFIDENCE_RANK = Object.freeze({ low: 1, medium: 2, high: 3 });

function mergePublicEvidence(candidates) {
  const grouped = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.value}`;
    const current = grouped.get(key) || {
      kind: candidate.kind,
      value: candidate.value,
      raw_found: true,
      verified_reachable: false,
      confidence: "low",
      evidence: [],
      source_provenance: [],
    };
    if (CONFIDENCE_RANK[candidate.confidence] > CONFIDENCE_RANK[current.confidence]) current.confidence = candidate.confidence;
    current.verified_reachable ||= candidate.verified_reachable;
    const evidenceKey = `${candidate.evidence.source_type}:${candidate.evidence.url}:${candidate.evidence.locator || ""}`;
    if (!current.evidence.some((item) => `${item.source_type}:${item.url}:${item.locator || ""}` === evidenceKey)) {
      current.evidence.push(candidate.evidence);
      current.source_provenance.push({ source_type: candidate.evidence.source_type, url: candidate.evidence.url });
    }
    grouped.set(key, current);
  }

  return [...grouped.values()].map((contact) => {
    // A raw discovery is never enough. Sendability requires high confidence,
    // provenance, and independent reachability evidence; all else stays held.
    const sendable = contact.confidence === "high" && contact.verified_reachable && contact.evidence.length > 0;
    return { ...contact, disposition: sendable ? "sendable" : "hold", sendable };
  });
}

function enrichPublicContacts(prospect = {}, publicSources = []) {
  const businessWebsite = normalizeUrl(prospect.website || prospect.website_url || prospect.websiteUrl);
  const candidates = [];
  const rejected_sources = [];

  for (const source of asArray(publicSources)) {
    if (!source || typeof source !== "object") continue;
    const type = normalizeSourceType(source.source_type || source.sourceType || source.type);
    const url = normalizeUrl(source.url || source.source_url || source.sourceUrl);
    if (!type || !url) {
      rejected_sources.push({ reason: !type ? "unsupported_source_type" : "missing_public_source_url" });
      continue;
    }
    for (const contact of contactsFromSource(source)) {
      const evidence = sourceEvidence(source, contact, businessWebsite);
      if (evidence) candidates.push(evidence);
    }
  }

  const contacts = mergePublicEvidence(candidates);
  return {
    prospect_id: prospect.id || prospect.prospect_id || null,
    business_website: businessWebsite,
    contacts,
    rejected_sources,
    summary: {
      raw_found: contacts.length,
      verified_reachable: contacts.filter((contact) => contact.verified_reachable).length,
      sendable: contacts.filter((contact) => contact.sendable).length,
      held: contacts.filter((contact) => !contact.sendable).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Send-time gate. lead-miner.js already computes and stores a full contact-
// confidence verdict (contact_enrichment / outreach_review_hold /
// outreach_hold_reasons) on every prospect row at mine time, but until now
// nothing at send time ever read it back — run-campaign/full-run/drip only
// ever checked "is prospect.email truthy", so a suppressed, conflicting, or
// low-confidence-source address was sent to exactly like a verified one.
//
// Note this is deliberately NOT "block unless outreach.review_hold === false".
// Today's Places-based miner never populates email reachability verification
// (email_reachable is always null), so review_hold is true for essentially
// every real lead mined so far — hard-gating on the raw flag would silently
// zero out the entire outreach pipeline. Instead this gate blocks only the
// hold reasons that reflect a known, concrete problem with the address
// (suppressed, conflicting duplicate addresses, or a low-confidence source
// such as a directory scrape) and lets a merely "unverified" address (the
// normal state for every GBP/website-scraped email today) proceed, same as
// before. Tighten this list once real reachability verification exists.
const HARD_CONTACT_HOLD_REASONS = Object.freeze([
  "email_conflict_review_required",
  "email_suppressed",
  "email_unreachable",
  "email_confidence_below_threshold",
]);

function asStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function embeddedRecord(prospect = {}) {
  return prospect && typeof prospect.record === "object" && prospect.record ? prospect.record : {};
}

// Reads the contact-confidence verdict off a prospect (or its embedded
// `record`), wherever the caller sourced it from — a fresh lib/prospects.js
// prospectFromRow() spread, a raw DB row, or a hand-built object. Returns
// hasEnrichment:false for any prospect mined before this verdict existed (or
// built without it, e.g. owner-proof smoke prospects) so legacy behavior is
// unchanged for that population.
function contactSendGate(prospect = {}) {
  const record = embeddedRecord(prospect);
  const enrichment = (prospect.contact_enrichment && typeof prospect.contact_enrichment === "object")
    ? prospect.contact_enrichment
    : (record.contact_enrichment && typeof record.contact_enrichment === "object" ? record.contact_enrichment : null);
  const hasEnrichment = Boolean(enrichment && enrichment.outreach && typeof enrichment.outreach === "object");
  if (!hasEnrichment) {
    return { hasEnrichment: false, blocked: false, reviewHold: false, holdReasons: [], sendableEmail: null };
  }
  const holdReasons = asStringArray(
    prospect.outreach_hold_reasons?.length ? prospect.outreach_hold_reasons : (record.outreach_hold_reasons?.length ? record.outreach_hold_reasons : enrichment.outreach.hold_reasons),
  );
  const reviewHold = Boolean(prospect.outreach_review_hold ?? record.outreach_review_hold ?? enrichment.outreach.review_hold);
  const hardReasons = holdReasons.filter((reason) => HARD_CONTACT_HOLD_REASONS.includes(reason));
  return {
    hasEnrichment: true,
    blocked: hardReasons.length > 0,
    blockedReasons: hardReasons,
    reviewHold,
    holdReasons,
    sendableEmail: normalizeEmail(enrichment.outreach.sendable_email || "") || null,
  };
}

module.exports = {
  SOURCE_POLICY,
  enrichContactEvidence,
  PUBLIC_SOURCE_TYPES,
  normalizeSourceType,
  normalizeUrl,
  normalizeEmail,
  normalizePhone,
  enrichPublicContacts,
  HARD_CONTACT_HOLD_REASONS,
  contactSendGate,
};
