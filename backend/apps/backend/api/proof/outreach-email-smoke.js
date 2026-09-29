"use strict";

const { requireAdminOrHardeningProof } = require("../../lib/proof-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { sendSequenceStep } = require("../../lib/email");
const { emailLogExists } = require("../../lib/full-run");

// Stable, business-derived slug (same scheme as vapi-tools/register-prospect and
// the CallPrep report), so an owner-proof prospect_id is DETERMINISTIC per
// business per run instead of a fresh random id on every send. This is the core
// of the duplicate-blast fix: a stable id lets the email_log de-dup a re-run.
function slugify(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function proofProspectId(businessName, city, runId) {
  const slug = slugify(`${businessName}-${city || ""}`) || slugify(businessName) || "business";
  return `proof_${slug}_${runId}`;
}

async function resendDetail(id) {
  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdminOrHardeningProof(req, res)) return;
  try {
    const body = await readJson(req).catch(() => ({}));
    if (body.confirm !== "SEND_OUTREACH_PROOF" && body.confirm !== "COMPOSE_ONLY") {
      sendJson(res, 400, { ok: false, error: "confirmation_required" });
      return;
    }
    const composeOnly = body.confirm === "COMPOSE_ONLY";
    const owner = process.env.GHOST_AGENCY_OWNER_EMAIL?.trim();
    if (!owner) {
      sendJson(res, 503, { ok: false, error: "owner_email_unset" });
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    // Optional per-prospect override for the supervised owner-preview trial
    // (build-and-send N real preview copies to the owner only). SAFETY: the
    // recipient is ALWAYS the owner address — override fields never change who
    // it goes to, so this can never send to a prospect.
    const clampStr = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
    const httpsUrl = (v) => (typeof v === "string" && /^https:\/\//i.test(v.trim()) ? v.trim() : "");

    // A STABLE run id: an explicit caller-supplied run_id when present, else the
    // day stamp. Combined with the per-business slug it yields a prospect_id
    // (`proof_<slug>_<runId>`) that is IDENTICAL across re-runs of the same batch,
    // so a repeated run reuses the same email_log rows and — with the
    // emailLogExists guard below — is a no-op instead of re-blasting the owner.
    const runId = clampStr(body.run_id, 60) || stamp;

    // Batch path: N real local businesses in one call, one owner-only email
    // each. Only a small, explicit field set is read from each item — email
    // is never one of them, so the request body can never steer a recipient.
    // MAX_BATCH_PROSPECTS bounds an accidental oversized array from firing an
    // unbounded number of sends into the owner's own inbox.
    const MAX_BATCH_PROSPECTS = 25;
    const prospects = Array.isArray(body.prospects) ? body.prospects.slice(0, MAX_BATCH_PROSPECTS) : [];
    if (prospects.length) {
      const results = [];
      for (const raw of prospects) {
        const p = (raw && typeof raw === "object") ? raw : {};
        const businessName = clampStr(p.business_name, 120);
        if (!businessName) {
          results.push({ business_name: null, ok: false, blocked: "business_name_required" });
          continue;
        }
        const forceReveal = Boolean(p.force_reveal);
        const previewUrl = forceReveal ? "" : httpsUrl(p.preview_url);
        const reference = clampStr(p.reference, 24);
        // Real per-prospect CallPrep report link (from adapters/callprep-report +
        // vapi-tools/register-prospect). httpsUrl() rejects anything non-https, and
        // reportUrlFor()/isCallPrepReportUrl() downstream only honor a genuine
        // callprep.wss-ai.com/report/... URL — otherwise it degrades to the generic
        // buildReportLink. So the visibility-report button opens the real populated
        // report when we have one, and never a fabricated grade.
        const reportUrl = httpsUrl(p.report_url);
        const prospectId = proofProspectId(businessName, clampStr(p.city, 80), runId);
        // IDEMPOTENCY GUARD: never re-send the SAME business for the SAME run.
        // Scoped to prospect_id ONLY (no email arg) on purpose: all 10 owner-proof
        // emails share the owner address, so passing the email would make the
        // shared owner email-hash short-circuit every business after the first.
        // emailLogExists fails CLOSED on a read error (skips rather than risk a
        // dupe). Compose-only always renders — there is no real send to protect.
        if (!composeOnly) {
          const dedup = await emailLogExists({ prospect_id: prospectId }).catch(() => ({ exists: true, reason: "dedup_check_error" }));
          if (dedup.exists) {
            results.push({ business_name: businessName, ok: true, skipped: true, reason: dedup.reason, prospect_id: prospectId });
            continue;
          }
        }
        const result = await sendSequenceStep({
          prospect: {
            prospect_id: prospectId,
            business_name: businessName,
            email: owner, // ALWAYS the owner — never overridable from the request body.
            status: "previewed",
            city: clampStr(p.city, 80),
            state: clampStr(p.state, 40),
            industry: clampStr(p.industry, 60),
            current_website: clampStr(p.current_website, 300),
            // Reference code (from vapi-tools/register-prospect) so the email can
            // tell the owner what to read to Riley. Recipient stays the owner.
            reference,
            // No fabricated rating/review_count/weaknesses here — we don't have
            // real grade data for these builds, and the visibility-snapshot card
            // hides itself rather than showing a fabricated grade. A real
            // report_url (when supplied) is threaded so the report button opens
            // the genuine populated CallPrep report instead of a generic link.
            report_url: reportUrl,
            preview_url: previewUrl,
          },
          sequence: 1,
          step: 1,
          dryRun: composeOnly,
          allowReviewHoldBypass: true,
          allowDeliveryPauseBypass: true,
          internalOwnerProof: true,
          allowBuildQualityBypass: true,
          allowContactHoldBypass: true,
          vars: { keyword_1: `${clampStr(p.industry, 60)} ${clampStr(p.city, 80)}`.trim(), reference, run_id: runId, force_reveal: forceReveal },
        });
        results.push({
          business_name: businessName,
          prospect_id: prospectId,
          skipped: false,
          ok: Boolean(composeOnly ? result.ok : (result.ok && result.id)),
          subject: result.subject || null,
          messageId: result.id || null,
          blocked: result.blocked || null,
          error: result.error || null,
        });
      }
      const allOk = results.length > 0 && results.every((r) => r.ok);
      sendJson(res, allOk ? 200 : 207, {
        ok: allOk,
        mode: composeOnly ? "compose_only_batch" : "send_batch",
        count: results.length,
        sentTo: `${owner.slice(0, 3)}***`,
        results,
      });
      return;
    }

    const o = (body.prospect && typeof body.prospect === "object") ? body.prospect : {};
    const singleBusinessName = clampStr(o.business_name, 120) || process.env.GHOST_AGENCY_PROOF_BUSINESS || "Signature Landscape";
    const result = await sendSequenceStep({
      prospect: {
        // Stable, business-derived id (no random suffix) so a repeated single-demo
        // send upserts the same email_log row instead of minting a fresh one.
        prospect_id: clampStr(o.prospect_id, 120) || proofProspectId(singleBusinessName, clampStr(o.city, 80) || "Mission Viejo", runId),
        business_name: singleBusinessName,
        email: owner,
        status: "previewed",
        city: clampStr(o.city, 80) || "Mission Viejo",
        state: clampStr(o.state, 40) || "CA",
        industry: clampStr(o.industry, 60) || "landscaping",
        // Realistic demo facts so the owner-proof report page reads like the
        // real thing instead of dashes (goes to the owner inbox only).
        rating: Number.isFinite(Number(o.rating)) ? Number(o.rating) : 4.9,
        review_count: Number.isFinite(Number(o.review_count)) ? Number(o.review_count) : 33,
        current_website: clampStr(o.current_website, 300) || "https://richarddiazlandscaping.com/",
        weaknesses: Array.isArray(o.weaknesses) && o.weaknesses.length
          ? o.weaknesses.map((w) => clampStr(w, 200)).filter(Boolean).slice(0, 4)
          : [
            "Website loads slowly on phones — most local searches happen there",
            "No clear call button above the fold",
            "Reviews are strong but not shown anywhere on the site",
          ],
        // Preview fallback rules (Mark, 2026-07-21): the generic no-override
        // smoke may fall back to the gold-standard demo build — but when the
        // caller supplies a REAL business override, the email must NEVER wear
        // another company's site (5 owner-review emails all rendered a stale
        // excavation demo via GHOST_AGENCY_PROOF_PREVIEW_URL). With an
        // override, use only what was supplied; empty preview degrades to the
        // reveal-link CTA instead of a mismatched thumbnail.
        report_url: httpsUrl(o.report_url) || (clampStr(o.business_name, 120) ? "" : process.env.GHOST_AGENCY_PROOF_REPORT_URL || ""),
        preview_url: httpsUrl(o.preview_url) || (clampStr(o.business_name, 120) ? "" : process.env.GHOST_AGENCY_PROOF_PREVIEW_URL || "https://ab-professional-detailing.wss-ai.com/"),
      },
      sequence: 1,
      step: 1,
      dryRun: composeOnly,
      allowReviewHoldBypass: true,
      allowDeliveryPauseBypass: true,
      internalOwnerProof: true,
      allowBuildQualityBypass: true,
      allowContactHoldBypass: true,
      vars: { keyword_1: clampStr(o.keyword_1, 60) || "landscaping Orange", run_id: runId },
    });
    if (composeOnly) {
      const html = result.htmlPreview || "";
      const reportMatch = html.match(/href="([^"]*\/api\/report[^"]*)"/);
      sendJson(res, 200, {
        ok: result.ok,
        mode: "compose_only",
        organic: result.organic ?? null,
        organicFail: result.organicFail ?? null,
        bodyPreview: result.bodyPreview ?? (result.previewText || "").slice(0, 600),
        subject: result.subject,
        hasPreviewButton: /See your new website/.test(html),
        hasReportButton: /See your visibility report/.test(html),
        reportUrl: reportMatch ? reportMatch[1].replace(/&amp;/g, "&") : "",
        hasBrandHeader: /WSS\s+Labs/i.test(html) && !/wsl-logo-horizontal/i.test(html),
        hasPhoneStrip: /Talk to a real person/.test(html),
        hasLegacyBrandText: /Woodward\s+Software\s+Labs/i.test(html),
        blocked: result.blocked || null,
      });
      return;
    }
    if (!result.ok || !result.id) {
      sendJson(res, 502, { ok: false, mode: result.mode, blocked: result.blocked, error: result.error });
      return;
    }
    const detail = await resendDetail(result.id);
    const from = detail.json.from || result.from || "";
    sendJson(res, detail.ok && /@go\.wss-ai\.com>?$/i.test(from) ? 200 : 502, {
      ok: detail.ok && /@go\.wss-ai\.com>?$/i.test(from),
      resendId: result.id,
      from,
      providerVerified: detail.ok,
      sentTo: `${owner.slice(0, 3)}***`,
      note: "One acquisition-path proof email sent to the configured owner address only.",
    });
  } catch (error) {
    handleError(res, error);
  }
};
