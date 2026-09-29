"use strict";
// lib/domains.js — real domain purchase + attach, via Vercel's registrar API.
//
// SAFETY: Vercel domain purchases are REAL MONEY, no test mode. This module
// is dry-run by default. Set DOMAIN_PURCHASE_ENABLED=true to allow a live
// charge. Every call — dry-run or live — is logged via recordEvent so nothing
// happens silently.

const { recordEvent, selectRows, upsertRow } = require("./store");

const VERCEL_API = "https://api.vercel.com";

function vercelHeaders() {
  return {
    Authorization: `Bearer ${process.env.VERCEL_TOKEN || ""}`,
    "Content-Type": "application/json",
  };
}

function teamQuery() {
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

// ---------------------------------------------------------------------------
// SPEND CONTROL
// ---------------------------------------------------------------------------
// Before this, DOMAIN_PURCHASE_ENABLED was the ONLY thing between a live Stripe
// key and an uncapped registrar API — and on 2026-07-31 it was found set to TRUE
// in production with no ceiling behind it. A flag is a switch, not a limit: one
// accidental flip could buy an unbounded number of domains at whatever price the
// registrar happened to quote.
//
// These caps sit INSIDE the live path, so they hold even when the flag is on.
// Every one FAILS CLOSED: an unset cap means "not configured yet", never
// "unlimited". There is no default, deliberately — a default ceiling is a
// number nobody chose.
const CAP_KEYS = ["DOMAIN_MAX_ORDER_USD", "DOMAIN_DAILY_CAP_USD", "DOMAIN_MONTHLY_CAP_USD"];

function capsFromEnv(env = process.env) {
  const n = (v) => {
    const x = Number(String(v ?? "").trim());
    return Number.isFinite(x) && x > 0 ? x : null;
  };
  return {
    perOrder: n(env[CAP_KEYS[0]]),
    daily: n(env[CAP_KEYS[1]]),
    monthly: n(env[CAP_KEYS[2]]),
  };
}

/** Rolling spend, read from the order ledger this module already writes. */
async function spentSince(isoFrom, deps = {}) {
  const rows = deps.selectRows || selectRows;
  const out = await rows("ghost_agency_domain_orders", {
    select: "payload,created_at",
    filter: `status=eq.purchased&created_at=gte.${isoFrom}`,
  }).catch(() => ({ rows: [] }));
  return (out.rows || []).reduce((sum, r) => {
    const p = Number(r && r.payload && r.payload.purchase && r.payload.purchase.price);
    return sum + (Number.isFinite(p) ? p : 0);
  }, 0);
}

/**
 * Refuse unless the price is known AND all three ceilings are configured AND
 * this order fits inside every one of them.
 */
async function assertWithinCaps(price, deps = {}) {
  const caps = capsFromEnv(deps.env);
  const missing = CAP_KEYS.filter((k, i) => !caps[["perOrder", "daily", "monthly"][i]]);
  if (missing.length) return { ok: false, reason: "spend_caps_unset", missing, caps };

  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "price_unknown", price };
  if (amount > caps.perOrder) return { ok: false, reason: "over_per_order_cap", price: amount, cap: caps.perOrder };

  const now = deps.now ? deps.now() : Date.now();
  const day = await spentSince(new Date(now - 864e5).toISOString(), deps);
  if (day + amount > caps.daily) return { ok: false, reason: "over_daily_cap", spent: day, price: amount, cap: caps.daily };

  const month = await spentSince(new Date(now - 30 * 864e5).toISOString(), deps);
  if (month + amount > caps.monthly) return { ok: false, reason: "over_monthly_cap", spent: month, price: amount, cap: caps.monthly };

  return { ok: true, caps, spentDay: day, spentMonth: month, price: amount };
}

/**
 * Per-order approval. A purchase is a two-step handshake: the first call writes
 * a pending row and stops; only an explicit, admin-authed approve lets the buy
 * proceed. No single automated pass can ever charge a card.
 */
async function purchaseApproved(domain, jobId, deps = {}) {
  if (!domain || !jobId) return false;
  const rows = deps.selectRows || selectRows;
  const out = await rows("ghost_agency_domain_orders", {
    select: "status,approved_by,approved_at,domain,job_id",
    filter: `domain=eq.${encodeURIComponent(domain)}&job_id=eq.${encodeURIComponent(jobId)}`,
  }).catch(() => ({ rows: [] }));
  const row = (out.rows || [])[0];
  return Boolean(row && row.status === "approved" && row.approved_by);
}

async function checkDomainAvailability(domain) {
  const res = await fetch(
    `${VERCEL_API}/v1/registrar/domains/${encodeURIComponent(domain)}/availability${teamQuery()}`,
    { headers: vercelHeaders() }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: json };
  }
  return { ok: true, ...json };
}

async function buyDomain(domain, { years = 1, contactInformation, jobId, deps = {} } = {}) {
  if (!process.env.VERCEL_TOKEN) {
    return { ok: false, dryRun: true, reason: "VERCEL_TOKEN not configured" };
  }
  const availability = await checkDomainAvailability(domain);
  if (!availability.ok || !availability.available) {
    return { ok: false, dryRun: false, reason: "domain_unavailable", availability };
  }

  const liveEnabled = String(process.env.DOMAIN_PURCHASE_ENABLED || "").toLowerCase() === "true";
  const payload = {
    autoRenew: false,
    years,
    expectedPrice: availability.price,
    contactInformation,
  };

  if (!liveEnabled) {
    // Dry run — never calls the real buy endpoint. Prevents accidental real charges
    // until DOMAIN_PURCHASE_ENABLED=true is explicitly set (post-approval).
    return {
      ok: true,
      dryRun: true,
      wouldBuy: { domain, ...payload },
      availability,
    };
  }

  // Caps and approval sit AFTER the flag but BEFORE any spend, so they apply on
  // every live path — including a future accidental flip of the flag.
  const cap = await assertWithinCaps(availability.price, deps);
  if (!cap.ok) {
    await recordEvent("ghost_agency_domain_refused", { domain, jobId: jobId || null, ...cap });
    return { ok: false, refused: true, ...cap };
  }
  if (!(await purchaseApproved(domain, jobId, deps))) {
    await recordEvent("ghost_agency_domain_pending_approval", { domain, jobId: jobId || null, price: cap.price });
    return { ok: false, pendingApproval: true, domain, jobId: jobId || null, price: cap.price };
  }

  const res = await fetch(
    `${VERCEL_API}/v1/registrar/domains/${encodeURIComponent(domain)}/buy${teamQuery()}`,
    { method: "POST", headers: vercelHeaders(), body: JSON.stringify(payload) }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, dryRun: false, status: res.status, error: json };
  }
  return { ok: true, dryRun: false, orderId: json.orderId, raw: json };
}

async function attachDomainToProject(domain, projectName) {
  const res = await fetch(`${VERCEL_API}/v10/projects/${projectName}/domains${teamQuery()}`, {
    method: "POST",
    headers: vercelHeaders(),
    body: JSON.stringify({ name: domain }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: json };
  }
  return { ok: true, raw: json };
}

/**
 * Full post-purchase domain fulfillment: buy (or dry-run) + attach to the
 * prospect's deployed Vercel project. Always logs a ghost_agency_domain_orders
 * row and a recordEvent, whether dry-run or live, success or failure.
 */
async function fulfillDomainForJob({ jobId, domain, projectName, contactInformation }) {
  const now = new Date().toISOString();
  if (!domain) {
    return { ok: false, skipped: true, reason: "no_desired_domain_on_job" };
  }

  const purchase = await buyDomain(domain, { contactInformation, jobId });
  let attach = null;
  if (purchase.ok && !purchase.dryRun && projectName) {
    attach = await attachDomainToProject(domain, projectName);
  }

  const row = await upsertRow(
    "ghost_agency_domain_orders",
    {
      job_id: jobId,
      domain,
      dry_run: !!purchase.dryRun,
      status: purchase.ok ? (purchase.dryRun ? "dry_run_only" : "purchased") : "failed",
      payload: { purchase, attach },
      updated_at: now,
    },
    "job_id,domain"
  );

  await recordEvent("ghost_agency_domain_fulfillment", {
    jobId,
    domain,
    purchase,
    attach,
    row,
  });

  return { ok: purchase.ok, dryRun: !!purchase.dryRun, purchase, attach, row };
}

module.exports = {
  assertWithinCaps,
  capsFromEnv,
  purchaseApproved,
  checkDomainAvailability,
  buyDomain,
  attachDomainToProject,
  fulfillDomainForJob,
};
