"use strict";

// api/factory-os.js — THE CHECKOUT PAGE A SIGNED LINK LANDS ON.
//
// Every paying path in this repo funnels here:
//   * /api/checkout-link redirects to ?checkout=contact&job=<id> when Stripe
//     cannot mint a session (STRIPE_SECRET_KEY unset) — and Stripe's own
//     success/cancel URLs point at ?checkout=success|cancelled.
//   * Until 2026-09-18 this route DID NOT EXIST: the redirect 302'd to a 404
//     on every machine that was not the operator's own desktop, so the
//     billing loop was click -> broken page -> no money.
//
// HONEST DEGRADATION IS THE WHOLE DESIGN. Two states, chosen SERVER-SIDE from
// the live provider status — never guessed client-side:
//
//   * STRIPE CONFIGURED -> a "pay by card" button that mints a real session
//     through the existing server-side flow (POST /api/checkout, which calls
//     lib/stripe.js createCheckoutSession — Stripe-hosted checkout; no
//     Stripe.js, no card fields, no publishable key on this page).
//   * STRIPE NOT CONFIGURED -> NO card form at all. The plan, the price the
//     prospect was already quoted ($149/mo, $500 setup waived — the ONE PRICE
//     every other surface in this repo renders), and a "we start now and
//     invoice you" contact path straight to the owner. A broken Stripe form
//     is worse than an honest invoice: it looks like a scam.
//
// The states a Stripe session itself sends the buyer back to (success /
// cancelled) explain what actually happened next: provisioning runs from the
// Stripe WEBHOOK (api/webhooks/stripe.js -> lib/fulfillment.js), not from
// this page, so the copy says "your invite email is on its way" rather than
// pretending the page provisioned anything.

const { providerStatus, publicConfig } = require("../lib/registry");
const { resolveRileyLine } = require("../lib/riley-line");
const { recordEvent, select } = require("../lib/store");

// THE PRICE, WRITTEN ONCE — the same $149/$500-waived the sign-up panel
// (lib/mirror-engine/signup-floater.js) and the proof email
// (lib/outreach-email-v3.js) quote. Three surfaces, one number, by law.
const PLAN_PRICE = "149";
const SETUP_FEE = "500";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);

function mailtoHref(ownerEmail, subject, body) {
  const params = new URLSearchParams({ subject, body });
  return `mailto:${ownerEmail}?${params.toString()}`;
}

// Best-effort personalization: the job row written when the checkout link was
// minted/clicked carries the business name. A missing row must never break
// the page — the plan and the contact path stand on their own.
async function businessNameForJob(jobId, read = select) {
  if (!jobId) return "";
  try {
    const found = await read(
      "ghost_agency_jobs",
      `select=business_name&job_id=eq.${encodeURIComponent(jobId)}&limit=1`,
    );
    return found && found.ok && Array.isArray(found.data) ? String(found.data[0]?.business_name || "") : "";
  } catch {
    return "";
  }
}

async function recordFactoryOsView(record, state, jobId, stripeReady) {
  if (typeof record !== "function") return;
  try {
    await Promise.resolve(record("factory_os_checkout_view", {
      state,
      jobId: String(jobId || "").slice(0, 200),
      stripeReady,
    })).catch(() => {});
  } catch {
    // Best-effort by contract — a ledger hiccup must not blank the page.
  }
}

function pageHtml({ state, jobId, businessName, stripeReady, ownerEmail, supportEmail, riley, apiUrl }) {
  const who = businessName ? esc(businessName) : "your business";
  const jobLine = jobId ? `<p class="job-ref">Reference: <code>${esc(jobId)}</code></p>` : "";
  const mailto = mailtoHref(
    ownerEmail,
    `START MY PLAN — ${businessName || "Local Growth Website Plan"}${jobId ? ` (ref ${jobId})` : ""}`,
    [
      "I want to start the Local Growth Website Plan ($149/mo, $500 setup fee waived).",
      businessName ? `Business: ${businessName}` : "",
      jobId ? `Reference: ${jobId}` : "",
      "Please send the invoice and get my site live.",
    ].filter(Boolean).join("\n"),
  );
  const rileyButton = riley && riley.telHref
    ? `<a class="btn btn-riley" href="${esc(riley.telHref)}">${riley.display ? `${esc(riley.display)} &mdash; ` : ""}call your web team</a>`
    : "";

  const planCard = `
    <div class="plan">
      <div class="eyebrow">Local Growth Website Plan</div>
      <div class="price">$${PLAN_PRICE}<small>/mo</small></div>
      <div class="waive"><s>$${SETUP_FEE} setup fee</s> &mdash; waived today</div>
      <ul>
        <li>Your site, launched and hosted &mdash; SSL included</li>
        <li>Your photos, logo &amp; brand &mdash; mined from your own site</li>
        <li>Pages written from your real services &amp; reviews</li>
        <li>The towns you serve &mdash; measured, never invented</li>
        <li>Lead capture &amp; unlimited edits</li>
      </ul>
    </div>`;

  // The card button only ever exists when the server KNOWS Stripe can mint a
  // session. It opens Stripe's own hosted checkout; no card data touches this
  // page, and a failed mint is reported as text instead of a dead spinner.
  const payCard = stripeReady ? `
    <div class="pay-block">
      <button id="wss-pay" class="btn btn-primary" type="button">Pay by card &mdash; secure checkout &rarr;</button>
      <p class="fine" id="wss-pay-status">You will be taken to Stripe's secure checkout page.</p>
      <script>
      (function(){
        var b=document.getElementById('wss-pay');if(!b)return;
        b.addEventListener('click',function(){
          var s=document.getElementById('wss-pay-status');
          b.disabled=true;if(s)s.textContent='Opening secure checkout\u2026';
          fetch('${esc(apiUrl || "")}/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:${JSON.stringify(String(jobId || ""))}})})
            .then(function(r){return r.json();})
            .then(function(j){
              var u=j&&j.checkout&&j.checkout.url;
              if(j&&j.ok&&u){window.location.href=u;return;}
              b.disabled=false;
              if(s)s.textContent='We could not open card checkout right now \u2014 use the email button below and we will start you on an invoice.';
            })
            .catch(function(){b.disabled=false;if(s)s.textContent='We could not open card checkout right now \u2014 use the email button below and we will start you on an invoice.';});
        });
      })();
      </script>
    </div>` : `
    <div class="pay-block">
      <div class="invoice-note">Online card checkout is not switched on yet. We start your plan now and invoice you directly &mdash; no card needed.</div>
    </div>`;

  const contactBlock = `
    <div class="contact-block">
      <a class="btn btn-primary" href="${esc(mailto)}">START MY PLAN &mdash; we&rsquo;ll invoice you &rarr;</a>
      ${rileyButton}
      <p class="fine">Or email ${esc(ownerEmail)}${supportEmail && supportEmail !== ownerEmail ? ` (or ${esc(supportEmail)})` : ""}. Keep your reference handy.</p>
    </div>`;

  let hero;
  if (state === "success") {
    hero = {
      eyebrow: "Payment received",
      title: `You're in, ${who === "your business" ? "welcome aboard" : who}.`,
      body: `<p>Your plan is active. Our fulfillment system is issuing your customer dashboard invite &mdash; a one-click magic link plus a 6-digit PIN &mdash; to the email address you paid with.</p>
      <p>If your invite hasn't arrived within a few minutes, email us and we'll resend it immediately.</p>`,
      show: jobLine + contactBlock,
    };
  } else if (state === "cancelled") {
    hero = {
      eyebrow: "Checkout cancelled",
      title: "No charge was made.",
      body: `<p>Nothing was billed and nothing was lost &mdash; your plan and your reference stay ready whenever you are.</p>`,
      show: planCard + (stripeReady ? payCard : "") + contactBlock + jobLine,
    };
  } else if (state === "contact") {
    hero = {
      eyebrow: "Start your plan",
      title: who === "your business" ? "Claim your new website." : `${who}, claim your new website.`,
      body: `<p>This is the plan your preview site was built for. Start today and the $${SETUP_FEE} setup fee is waived.</p>`,
      show: planCard + payCard + contactBlock + jobLine,
    };
  } else {
    hero = {
      eyebrow: "Local Growth Website Plan",
      title: "Your site, launched and growing.",
      body: `<p>The done-for-you local website plan: we build it, host it, and keep editing it for you.</p>`,
      show: planCard + payCard + contactBlock,
    };
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(hero.eyebrow)} &mdash; WSS Labs</title>
<meta name="robots" content="noindex">
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;background:#0e0f12;color:#f4f4f5;line-height:1.55}
main{max-width:640px;margin:0 auto;padding:40px 20px 64px}
.brand{display:flex;align-items:center;gap:9px;margin-bottom:34px;font-weight:800;letter-spacing:.01em}
.brand small{display:block;font-weight:500;opacity:.6;font-size:11px}
.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.6;margin-bottom:8px}
h1{font-size:32px;line-height:1.15;margin:0 0 14px;letter-spacing:-.02em}
p{margin:0 0 14px}
.plan{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:18px 20px;margin:22px 0}
.price{font-size:40px;font-weight:800;letter-spacing:-.02em}
.price small{font-size:15px;font-weight:600;opacity:.65}
.waive{display:inline-block;font-size:12.5px;margin-top:4px;padding:3px 10px;border-radius:999px;background:rgba(52,211,153,.14);color:#6ee7b7}
.plan ul{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:7px}
.plan li{font-size:13.5px;padding-left:18px;position:relative;opacity:.93}
.plan li:before{content:'\\2713';position:absolute;left:0;color:#34d399;font-weight:700}
.btn{display:block;width:100%;text-align:center;text-decoration:none;border:0;border-radius:10px;padding:14px 16px;font-size:15px;font-weight:700;margin:10px 0;cursor:pointer;font-family:inherit}
.btn-primary{background:#e5484d;color:#fff}
.btn-riley{background:#fff;color:#111}
.pay-block,.contact-block{margin:18px 0}
.invoice-note{background:rgba(229,72,77,.09);border:1px solid rgba(229,72,77,.3);border-radius:10px;padding:12px 14px;font-size:13.5px}
.fine{font-size:12.5px;opacity:.65}
.job-ref{font-size:12.5px;opacity:.75}
code{background:rgba(255,255,255,.08);border-radius:5px;padding:1px 6px;font-size:12px}
</style>
</head>
<body>
<main>
  <div class="brand"><svg width="24" height="24" viewBox="0 0 64 64" aria-hidden="true"><path d="M12 24 L21 42 L30 26 L39 42 L50 20" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="20" r="5" fill="#34d399"/></svg><span>WSS Labs<small>site &amp; AI team</small></span></div>
  <div class="eyebrow">${esc(hero.eyebrow)}</div>
  <h1>${hero.title}</h1>
  ${hero.body}
  ${hero.show}
</main>
</body>
</html>`;
}

function createFactoryOsHandler(overrides = {}) {
  const status = overrides.providerStatus || providerStatus;
  const config = overrides.publicConfig || publicConfig;
  const read = overrides.select || select;
  const record = overrides.recordEvent || recordEvent;
  const resolveLine = overrides.resolveRileyLine || resolveRileyLine;

  return async function handler(req, res) {
    if (!req || req.method !== "GET") {
      if (res) {
        res.setHeader("Allow", "GET");
        res.statusCode = 405;
        res.end("Method not allowed");
      }
      return;
    }
    try {
      const state = String(req.query?.checkout || "").trim().toLowerCase();
      const jobId = String(req.query?.job || "").trim().slice(0, 200);
      const stripeReady = Boolean(status().stripe?.configured);
      const cfg = config();
      const businessName = await businessNameForJob(jobId, read);
      // The agency line speaks FOR the agency on this page (same rule as the
      // sign-up panel: allowAgencyLine), and is omitted entirely when no line
      // resolves — never a placeholder number.
      const riley = resolveLine({ allowAgencyLine: true, env: process.env }) || {};
      if (state) {
        await recordFactoryOsView(record, state || "landing", jobId, stripeReady);
      }
      const html = pageHtml({
        state: ["contact", "success", "cancelled"].includes(state) ? state : "",
        jobId,
        businessName,
        stripeReady,
        ownerEmail: cfg.ownerEmail || cfg.supportEmail,
        supportEmail: cfg.supportEmail,
        riley,
        apiUrl: cfg.apiUrl,
      });
      if (res) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "private, no-store, max-age=0");
        res.end(html);
      }
    } catch (error) {
      if (res) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end("<!doctype html><meta charset=\"utf-8\"><title>Checkout unavailable</title><p>We could not open this page. Please reply to the email that brought you here and the launch team will help.</p>");
      }
    }
  };
}

module.exports = createFactoryOsHandler();
module.exports.createFactoryOsHandler = createFactoryOsHandler;
module.exports.businessNameForJob = businessNameForJob;
module.exports.pageHtml = pageHtml;
module.exports.PLAN_PRICE = PLAN_PRICE;
module.exports.SETUP_FEE = SETUP_FEE;
