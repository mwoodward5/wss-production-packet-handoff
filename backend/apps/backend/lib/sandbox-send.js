"use strict";

// Sandbox send routing.
//
// Sandbox mode lets an operator run the REAL machine — mining, scoring, and
// site generation all execute for real — while guaranteeing that not a single
// outreach email can reach a real prospect. Every send is force-routed to the
// configured owner address (GHOST_AGENCY_OWNER_EMAIL), reusing the same
// strict-owner-recipient assertion posture as api/admin/owner-smoke.js.
//
// Fail-closed: if the owner address is not configured, sandbox mode refuses to
// send rather than silently falling back to real prospect recipients.

function ownerSandboxAddress() {
  return String(process.env.GHOST_AGENCY_OWNER_EMAIL || "").trim();
}

// Clone a prospect with every recipient field forced to the owner address so
// the downstream sender can only ever resolve the owner. Identity fields
// (prospect_id, business_name, preview mapping) are preserved so per-business
// de-dup and preview-identity gates keep working — de-dup MUST be evaluated on
// the ORIGINAL prospect (real email) before this override, so each of N leads
// still produces exactly one email (one per business, all to the owner).
function forceOwnerRecipient(prospect, owner) {
  return {
    ...prospect,
    email: owner,
    ownerEmail: owner,
    owner_email: owner,
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

// Defense in depth: confirm the resolved recipient is exactly the owner and no
// stray non-owner recipient field survived the override.
function assertOwnerOnly(prospect, owner) {
  const target = normalizeEmail(owner);
  if (!target) return false;
  return [prospect.email, prospect.ownerEmail, prospect.owner_email]
    .filter((v) => v != null && String(v).trim() !== "")
    .every((v) => normalizeEmail(v) === target);
}

module.exports = { ownerSandboxAddress, forceOwnerRecipient, assertOwnerOnly, normalizeEmail };
