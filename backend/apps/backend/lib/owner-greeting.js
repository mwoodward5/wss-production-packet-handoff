"use strict";
// Verified-owner greeting.
// TRUTH LAW: address a prospect by the owner's name ONLY when the LeadMiner
// extractor VERIFIED it (owner_name_verified === true from BBB / Secretary of
// State / an explicit About-page owner title). Never use an unverified or guessed
// name — a wrong "Hey Carl" is worse than none. Otherwise fall back to the
// business name, then a neutral "there".
//
// DORMANT until the LeadMiner owner-name extractor is enabled
// (EMAIL_HUNTER_OWNERNAME_ENABLED=true + SoS allowlist + provider creds). Until
// then no record carries owner_name_verified, so every greeting resolves to the
// business name. See lead-spark-ai PR #4 (the verified extractor + export fields).

function firstNameOf(name) {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return first.length > 1 ? first : "";
}

function isTrue(value) {
  return value === true || value === "true";
}

// Accepts a single record OR an array of candidate source records (the email
// canonical path passes several).
function toSources(input) {
  if (Array.isArray(input)) return input.filter((s) => s && typeof s === "object");
  return input && typeof input === "object" ? [input] : [];
}

// A verified owner's FIRST name, or "" if no source has a verified owner name.
function verifiedOwnerFirstName(input) {
  for (const source of toSources(input)) {
    if (isTrue(source.owner_name_verified ?? source.ownerNameVerified)) {
      const first = firstNameOf(source.owner_name ?? source.ownerName);
      if (first) return first;
    }
  }
  return "";
}

// Outreach opening "Hi {x},":
//   · a VERIFIED owner's first name -> "Hi John,"
//   · else the business name WITH "team" -> "Hi Acme Plumbing team," (the
//     natural way to greet a company you have no verified person for; this is
//     the copy every outreach greeting used before the owner-name feature —
//     the feature ADDED the verified-name path and accidentally dropped the
//     " team" suffix from the fallback, which this restores)
//   · else a neutral "there" -> "Hi there,"
// dashboardWelcomeName is deliberately NOT given the suffix ("Welcome, Acme
// Plumbing", not "…team"), so the two surfaces read correctly for their place.
function emailGreetingName(input, businessName = "") {
  const owner = verifiedOwnerFirstName(input);
  if (owner) return owner;
  const biz = String(businessName || "").trim();
  return biz ? `${biz} team` : "there";
}

// Dashboard header "Welcome, {x}": verified owner first name, else business name, else "".
function dashboardWelcomeName(input, businessName = "") {
  return verifiedOwnerFirstName(input) || String(businessName || "").trim() || "";
}

module.exports = {
  firstNameOf,
  verifiedOwnerFirstName,
  emailGreetingName,
  dashboardWelcomeName,
};
