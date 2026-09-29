"use strict";

// api/admin/domain-approve.js — THE SECOND HAND ON THE MONEY.
//
// lib/domains.js refuses to buy unless an approval row exists that names a
// human. This is the only thing that can write that row, and it is admin-authed.
//
// Why a separate endpoint rather than a flag on the build: on 2026-07-31
// production was found with DOMAIN_PURCHASE_ENABLED=true, a live Stripe key and
// no ceiling anywhere. One switch stood between an automated pipeline and an
// uncapped registrar. Approval is deliberately a SECOND, human, out-of-band
// action so no single automated pass — and no single misconfigured flag — can
// charge a card.
//
// THREE REFUSALS, each a real failure mode rather than defensive noise:
//   · no pending row              — approving something nobody requested
//   · already purchased           — a retry double-charging
//   · quote exceeds quoted_price  — registrar prices move between the quote the
//                                   human saw and the moment of purchase; the
//                                   approval is for a PRICE, not just a domain

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { selectRows, upsertRow, recordEvent } = require("../../lib/store");
const { checkDomainAvailability, capsFromEnv } = require("../../lib/domains");

const TERMINAL = new Set(["purchased", "attached"]);

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!(await requireAdmin(req, res))) return;

  try {
    const body = await readJson(req).catch(() => ({}));
    const jobId = String(body.job_id || body.jobId || "").trim();
    const domain = String(body.domain || "").trim().toLowerCase();
    // Whoever the admin layer says this is. Never a value the caller supplies —
    // "approved by whom?" must have an answer that cannot be spoofed in a body.
    const approver = String(
      req.adminIdentity || req.headers["x-admin-identity"] || "admin",
    ).trim();

    if (!jobId || !domain) {
      return sendJson(res, 400, { ok: false, error: "job_id_and_domain_required" });
    }

    const found = await selectRows("ghost_agency_domain_orders", {
      select: "id,job_id,domain,status,quoted_price,approved_by,approved_at,payload",
      filter: `job_id=eq.${encodeURIComponent(jobId)}&domain=eq.${encodeURIComponent(domain)}`,
    }).catch(() => ({ rows: [] }));
    const row = (found.rows || [])[0];

    // REFUSAL 1 — nothing requested this.
    if (!row) {
      await recordEvent("ghost_agency_domain_approve_refused", { jobId, domain, reason: "no_pending_order" });
      return sendJson(res, 404, {
        ok: false, error: "no_pending_order",
        message: "No domain order exists for that job and domain. A purchase must be requested before it can be approved.",
      });
    }

    // REFUSAL 2 — already bought. Approving again is how a retry double-charges.
    if (TERMINAL.has(String(row.status || "").toLowerCase())) {
      await recordEvent("ghost_agency_domain_approve_refused", { jobId, domain, reason: "already_purchased", status: row.status });
      return sendJson(res, 409, {
        ok: false, error: "already_purchased", status: row.status,
        message: "This domain has already been purchased. Approving it again could charge the card twice.",
      });
    }

    // REFUSAL 3 — the price moved. The approval was for an amount, not a name.
    const quoted = Number(row.quoted_price);
    if (Number.isFinite(quoted) && quoted > 0) {
      const live = await checkDomainAvailability(domain).catch(() => ({ ok: false }));
      const current = Number(live && live.price);
      if (!live.ok || !Number.isFinite(current)) {
        await recordEvent("ghost_agency_domain_approve_refused", { jobId, domain, reason: "price_unverifiable" });
        return sendJson(res, 502, {
          ok: false, error: "price_unverifiable",
          message: "Could not re-check the registrar price. Refusing to approve a purchase whose cost cannot be confirmed.",
        });
      }
      if (current > quoted) {
        await recordEvent("ghost_agency_domain_approve_refused", {
          jobId, domain, reason: "quote_exceeded", quoted, current,
        });
        return sendJson(res, 409, {
          ok: false, error: "quote_exceeded", quoted, current,
          message: `The registrar now quotes ${current}, above the ${quoted} this order was raised at. Re-request at the new price.`,
        });
      }
    }

    const now = new Date().toISOString();
    const saved = await upsertRow(
      "ghost_agency_domain_orders",
      { job_id: jobId, domain, status: "approved", approved_by: approver, approved_at: now, updated_at: now },
      "job_id,domain",
    );
    await recordEvent("ghost_agency_domain_approved", { jobId, domain, approver, at: now });

    // Surfaced so an approver can see the purchase is STILL capped. Approval is
    // permission, not funding — an unset cap refuses regardless.
    const caps = capsFromEnv();
    return sendJson(res, 200, {
      ok: true, job_id: jobId, domain, status: "approved",
      approved_by: approver, approved_at: now,
      caps_configured: Boolean(caps.perOrder && caps.daily && caps.monthly),
      note: "Approval recorded. The purchase still refuses unless the spend caps are configured and the flag is on.",
      persisted: saved && saved.mode,
    });
  } catch (error) {
    handleError(res, error);
  }
};
