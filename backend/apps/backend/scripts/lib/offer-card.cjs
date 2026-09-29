"use strict";
// scripts/lib/offer-card.cjs — the dark offer card, adapted from the layout the
// owner flagged as the visual bar: eyebrow, price anchored against agency cost,
// emoji-led scan-list, one loud CTA, payment trust line, low-pressure fallback.
//
// TWO DELIBERATE DEPARTURES FROM THE REFERENCE:
//
// 1. Only claims with verified:true in artifacts/ramon-qa/product-claims.json
//    render. The reference email promised lead capture, unlimited edits, a free
//    custom domain, directory indexing, Maps *registry* and WSS Connect — six
//    things that are not true today. Lead capture is the sharpest: the endpoint
//    currently 404s, so that bullet would promise a form that reaches nobody.
//    Held claims are not deleted from the file, they just don't render, so the
//    moment one becomes true it appears with no copy rewrite.
//
// 2. The card is keyed to the CLIENT'S OWN measured accent, not a fixed orange.
//    Ramon's card is #C53F34 because that is their logo. It costs nothing and
//    it is the difference between "a template" and "mine".

const fs = require("node:fs");

const CLAIMS_PATH = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/artifacts/ramon-qa/product-claims.json";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Verified claims only, with {{BUSINESS_NAME}} filled from the real client. */
function verifiedClaims(businessName) {
  if (!fs.existsSync(CLAIMS_PATH)) return { rendered: [], held: [] };
  const doc = JSON.parse(fs.readFileSync(CLAIMS_PATH, "utf8"));
  const rendered = [], held = [];
  for (const c of doc.claims || []) {
    if (!c.emoji) { held.push(c); continue; }          // the price-anchor line
    // BOTH text and short must be filled. Substituting only `text` shipped a
    // literal "built for {{BUSINESS_NAME}}" into the rendered feature rail —
    // caught by reading the fold screenshot, not by any gate, because an
    // unsubstituted token is still a "verified" claim as far as the flags go.
    (c.verified === true ? rendered : held).push({
      ...c,
      text: String(c.text).replace(/\{\{BUSINESS_NAME\}\}/g, businessName),
      ...(c.short ? { short: String(c.short).replace(/\{\{BUSINESS_NAME\}\}/g, businessName) } : {}),
    });
  }
  return { rendered, held };
}

/**
 * Live price from Stripe. Never hardcoded, never guessed.
 * Returns null when it cannot be confirmed — the caller then omits the whole
 * price line rather than printing a number nobody verified.
 *
 * LIVEMODE GATE (added 2026-07-30 after a real near-miss): the canonical price
 * IDs are LIVE-mode objects, but the key in .fable-proof.env is sk_test_. The
 * canonical lookup therefore 404s ("a similar object exists in live mode"),
 * while the legacy STRIPE_*_PRICE_ID aliases DO resolve — to test-mode objects
 * at 19900. A test-mode price is a sandbox record, not what a customer would
 * ever be charged, so printing it in a customer email would be exactly the
 * hardcoded-number failure this function exists to prevent. Anything with
 * livemode !== true is refused and the reply-for-pricing fallback renders.
 * Returns a {reason} on the diagnostic channel so a silent null is never
 * mistaken for "nobody asked".
 */
async function livePrice(plan = "solo", diag = null) {
  const note = (reason, extra) => { if (diag) diag.push({ plan, reason, ...(extra || {}) }); return null; };
  const sk = String(process.env.STRIPE_SECRET_KEY || "").trim();
  let priceId = null;
  try {
    const billing = require("../../lib/billing-readiness");
    if (typeof billing.resolvePlanPriceId === "function") priceId = billing.resolvePlanPriceId(plan, process.env, { annual: false });
  } catch { /* resolver unavailable */ }
  if (!sk) return note("stripe_secret_missing");
  if (!priceId) return note("price_id_unresolved");
  const r = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
    headers: { Authorization: `Bearer ${sk}` },
  }).catch(() => null);
  if (!r) return note("stripe_unreachable", { priceId });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return note(`stripe_http_${r.status}`, { priceId, stripeError: body && body.error && body.error.message });
  if (typeof body.unit_amount !== "number") return note("no_unit_amount", { priceId });
  if (body.livemode !== true) return note("test_mode_price_refused", { priceId, unit_amount: body.unit_amount });
  if (body.active !== true) return note("price_inactive", { priceId });
  return {
    amount: body.unit_amount / 100,
    currency: String(body.currency || "usd").toUpperCase(),
    interval: (body.recurring && body.recurring.interval) || "month",
  };
}

function claimRow(c) {
  return `<tr>
    <td width="26" valign="top" style="padding:5px 0;font-size:15px;line-height:1.5">${c.emoji}</td>
    <td valign="top" style="padding:5px 0;font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#e8e8e3">${esc(c.text)}</td>
  </tr>`;
}

/**
 * THE ABOVE-THE-FOLD FEATURE RAIL.
 *
 * Same verified-claims-only rule as the card — it reads the identical
 * verifiedClaims() list, so a claim can never appear here that could not appear
 * there. The only difference is that it renders the claim's `short` compression
 * instead of its full sentence, because 15 full sentences are ~500px of prose
 * and push everything the owner cares about below the fold.
 *
 * A verified claim with no `short` falls back to its full `text` rather than
 * being silently dropped — a missing label must never quietly delete a feature.
 *
 * Rendered as a two-column TABLE, not floated/inline-block pills: Outlook's Word
 * engine ignores inline-block and would stack all 15 into one column, which is
 * exactly the below-the-fold problem this block exists to solve.
 */
function featureRail({ business, accent }) {
  const { rendered } = verifiedClaims(business);
  if (!rendered.length) return "";

  const cell = (c) =>
    `<td width="50%" valign="top" style="width:50%;padding:0 4px 6px 0">
       <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
         <td width="18" valign="top" style="font-size:12px;line-height:1.35">${c.emoji}</td>
         <td valign="top" style="font:400 12px/1.35 -apple-system,Segoe UI,Roboto,sans-serif;color:#33332c;white-space:nowrap">${esc(c.short || c.text)}</td>
       </tr></table>
     </td>`;

  const rows = [];
  for (let i = 0; i < rendered.length; i += 2) {
    rows.push(`<tr>${cell(rendered[i])}${rendered[i + 1] ? cell(rendered[i + 1]) : '<td width="50%" style="width:50%">&nbsp;</td>'}</tr>`);
  }

  return `<tr><td style="padding:6px 28px 2px" class="pad">
    <div style="font:700 10px/1.3 sans-serif;letter-spacing:.11em;text-transform:uppercase;color:${accent};margin-bottom:8px">
      All ${rendered.length} included — no extra charge
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="table-layout:fixed">
      ${rows.join("")}
    </table>
  </td></tr>`;
}

/**
 * The commitment CTA, split out of offerCard() so the rebuilt email can place
 * the feature rail high and the ask last. offerCard() still composes it, so the
 * older sample email renders byte-identically to before this split.
 */
function ctaBlock({ business, accent, claimUrl, price, draft, ctaLabel, inCard }) {
  const priceBlock = price
    ? `<div style="font:800 34px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#fff;margin:0 0 4px">
         $${esc(price.amount)}<span style="font:400 15px/1 sans-serif;color:#b9b9b2">/${esc(price.interval)}</span>
       </div>
       <div style="font:400 13px/1.5 sans-serif;color:#b9b9b2">No setup fee. Cancel anytime.</div>`
    : `<div style="font:700 17px/1.4 sans-serif;color:#fff;margin:0 0 4px">Simple monthly pricing</div>
       <div style="font:400 13px/1.5 sans-serif;color:#b9b9b2">Reply and I'll send exact pricing — I'd rather quote it than guess it in an email.</div>`;

  const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#141414;border-radius:14px">
      <tr><td style="padding:24px 24px 22px">
        ${priceBlock}
        <a href="${esc(claimUrl)}" style="display:block;text-align:center;background:${accent};color:#fff;font:700 16px/1 sans-serif;text-decoration:none;padding:17px;border-radius:9px;margin-top:18px">
          ${esc(ctaLabel || (draft ? "→ Review this sample" : `→ Launch ${business}'s site`))}
        </a>
        <div style="text-align:center;font:400 11px/1.5 sans-serif;color:#8a8a82;margin-top:11px">
          🔒 Payments are handled by Stripe — we never see or store your card
        </div>
      </td></tr>
    </table>
    <div style="font:400 13px/1.65 sans-serif;color:#4a4a44;margin-top:14px">
      <strong>Not ready?</strong> Totally fine. Reply <strong>WALKTHROUGH</strong> and I'll send a
      60-second video tour of the site. No card, no call.
    </div>`;

  return inCard ? inner : `<tr><td style="padding:18px 28px 8px" class="pad">${inner}</td></tr>`;
}

/**
 * @param {object} o
 * @param {string} o.business      client name
 * @param {string} o.accent        the client's own measured hex
 * @param {string} o.claimUrl      where the CTA goes
 * @param {object|null} o.price    from livePrice(), or null to omit
 * @param {boolean} o.draft        true = sample/unverified, softens the CTA
 * @param {string}  [o.ctaLabel]   overrides the button text when the default
 *                                 would overstate what the link actually does.
 *                                 STALE NOTE CORRECTED 2026-07-31. This used to
 *                                 claim ghost.wss-ai.com/claim 404s and that
 *                                 GHOST_AGENCY_CHECKOUT_LINK_SECRET was unset, so
 *                                 checkoutLinkStatus() returned contact_fallback.
 *                                 Both are false on production now: the secret IS
 *                                 set, checkoutLinkStatus() returns
 *                                 "signed_redirect", and /api/health reports
 *                                 readyForCheckout:true, mode checkout_session.
 *                                 A mailto: CTA is now a deliberate choice here,
 *                                 not a forced fallback.
 */
function offerCard({ business, accent, claimUrl, price, draft, ctaLabel }) {
  const { rendered } = verifiedClaims(business);
  const rows = rendered.map(claimRow).join("\n");

  // Price block only when a live Stripe amount came back.
  const priceBlock = price
    ? `<div style="font:800 40px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#fff;margin:14px 0 4px">
         $${esc(price.amount)}<span style="font:400 15px/1 sans-serif;color:#b9b9b2">/${esc(price.interval)}</span>
       </div>
       <div style="font:400 13px/1.5 sans-serif;color:#b9b9b2">No setup fee. Cancel anytime.</div>`
    : `<div style="font:700 17px/1.4 sans-serif;color:#fff;margin:14px 0 4px">Simple monthly pricing</div>
       <div style="font:400 13px/1.5 sans-serif;color:#b9b9b2">Reply and I'll send exact pricing — I'd rather quote it than guess it in an email.</div>`;

  return `<tr><td style="padding:24px 28px 8px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#141414;border-radius:14px">
      <tr><td style="padding:26px 26px 22px">

        <div style="font:700 11px/1.4 sans-serif;letter-spacing:.13em;text-transform:uppercase;color:${accent}">
          ✦ It's already built — here's what's in it
        </div>

        ${priceBlock}

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px">
          ${rows}
        </table>

        <a href="${esc(claimUrl)}" style="display:block;text-align:center;background:${accent};color:#fff;font:700 16px/1 sans-serif;text-decoration:none;padding:17px;border-radius:9px;margin-top:22px">
          ${esc(ctaLabel || (draft ? "→ Review this sample" : `→ Launch ${business}'s site`))}
        </a>

        <div style="text-align:center;font:400 11px/1.5 sans-serif;color:#8a8a82;margin-top:11px">
          🔒 Payments are handled by Stripe — we never see or store your card
        </div>

      </td></tr>
    </table>

    <div style="font:400 13px/1.65 sans-serif;color:#4a4a44;margin-top:16px">
      <strong>Not ready?</strong> Totally fine. Reply <strong>WALKTHROUGH</strong> and I'll send a
      60-second video tour of the site. No card, no call.
    </div>
  </td></tr>`;
}

module.exports = { offerCard, verifiedClaims, livePrice, featureRail, ctaBlock };
