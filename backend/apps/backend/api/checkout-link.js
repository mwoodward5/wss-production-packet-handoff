"use strict";

const { verifyCheckoutLink } = require("../lib/checkout-links");
const { createCheckoutSession } = require("../lib/stripe");
const { publicConfig } = require("../lib/registry");
const { recordEvent, select } = require("../lib/store");

// The signed link payload only ever carries the handful of fields baked in
// at mint time (see lib/checkout-links.js buildCheckoutLink). A prospect's
// site can get rebuilt/redeployed, or a desired domain can be added, any
// time inside the 45-day link TTL, so we also do a live lookup of the
// prospect's current DB row here (same idea api/launch.js already uses) and
// let it enrich -- never replace -- what the signed token proved. If the
// lookup fails or the row isn't found, we fall back to signed-payload-only
// fields exactly as before; this is additive and never blocks checkout.
async function liveProspectEnrichment(prospectId, read = select) {
  if (!prospectId) return {};
  try {
    const found = await read(
      "ghost_agency_prospects",
      `prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
    );
    const row = found && found.ok && Array.isArray(found.data) ? found.data[0] : null;
    if (!row) return {};
    const record = row.record || {};
    return {
      ownerEmail: row.owner_email || record.owner_email || "",
      desiredDomain: record.desired_domain || "",
      previewProjectName: record.preview_project_name || "",
    };
  } catch {
    // Live enrichment is best-effort. A DB hiccup must not break an
    // otherwise-valid signed checkout link.
    return {};
  }
}

// CHECKOUT-CLICK TRUTH: completions arrive when Stripe's webhook fires, but
// the click itself — the top of the conversion funnel — used to leave no
// durable trace, so "how many businesses opened checkout" was unanswerable.
// One best-effort event per click closes that gap:
//
//   * Recorded only AFTER the signature verifies: an unverifiable token is
//     not a prospect's click, it is a scan, and scans do not count.
//   * Idempotent by construction: the payload is exactly the signed
//     prospect identity (plus the literal source), so recordEvent's
//     deterministic id collapses repeat clicks by the same prospect onto
//     one durable row.
//   * NEVER able to break checkout: wrapped so a ledger hiccup cannot
//     alter the redirect a paying business is waiting on.
async function recordCheckoutClick(record, payload) {
  if (typeof record !== "function") return;
  try {
    await Promise.resolve(record("checkout.click", {
      jobId: payload.job_id,
      prospectId: payload.prospect_id,
      businessName: payload.business_name,
      industry: payload.industry,
      city: payload.city,
      state: payload.state,
      source: "signed_checkout_link",
    })).catch(() => {});
  } catch {
    // Best-effort by contract.
  }
}

function createCheckoutLinkHandler(overrides = {}) {
  const verify = overrides.verifyCheckoutLink || verifyCheckoutLink;
  const mint = overrides.createCheckoutSession || createCheckoutSession;
  const read = overrides.select || select;
  const record = overrides.recordEvent || recordEvent;
  const config = overrides.publicConfig || publicConfig;

  return async function handler(req, res) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.statusCode = 405;
      return res.end("Method not allowed");
    }
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    try {
      const check = verify(req.query?.token, req.query?.sig);
      if (!check.ok) {
        res.statusCode = check.reason === "expired" ? 410 : 401;
        return res.end("This secure website launch link is no longer valid. Please reply to the email for a fresh link.");
      }
      const p = check.payload;
      await recordCheckoutClick(record, p);
      const live = await liveProspectEnrichment(p.prospect_id, read);
      const checkout = await mint({
        desiredDomain: live.desiredDomain || "",
        previewProjectName: live.previewProjectName || "",
        job: {
          id: p.job_id,
          product: "Local Growth Website Plan",
          owner: "Woodward Software",
          prospect: {
            id: p.prospect_id,
            businessName: p.business_name,
            industry: p.industry,
            city: p.city,
            state: p.state,
            ownerEmail: live.ownerEmail || "",
          },
        },
      });
      if (checkout.mode === "checkout_session" && checkout.url) {
        res.statusCode = 302;
        res.setHeader("Location", checkout.url);
        return res.end();
      }
      const fallback = `${config().publicAppUrl.replace(/\/+$/, "")}/factory-os?checkout=contact&job=${encodeURIComponent(p.job_id)}`;
      res.statusCode = 302;
      res.setHeader("Location", fallback);
      return res.end();
    } catch {
      res.statusCode = 500;
      return res.end("We could not open checkout. Please reply to the email and the launch team will help.");
    }
  };
}

module.exports = createCheckoutLinkHandler();
module.exports.createCheckoutLinkHandler = createCheckoutLinkHandler;
module.exports.recordCheckoutClick = recordCheckoutClick;
