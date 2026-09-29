"use strict";

// api/admin/send-mirror-proof.js — the one owner-proof delivery door.
//
// SAFETY, in order:
//   1. Admin token and configured owner address are required.
//   2. A durable Line row must be ready/queued/sent and name this exact
//      prospect, preview, build hash, batch, and signed Mirror release.
//   3. The canonical prospect record must carry that same passing release.
//   4. The active registry tuple and exact public router bytes are re-verified.
//   5. A durable claim is written before the provider call. Completed retries
//      return the stored provider receipt without a second provider call.
//   6. internalOwnerProof fixes the envelope to the owner with no CC/BCC.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { outreachBuildQuality, sendSequenceStep } = require("../../lib/email");
const { deliverOwnerProof, lineArtifactIdentity } = require("../../lib/owner-proof-delivery");
const { prospectFromRow } = require("../../lib/prospects");
const { sanitizePreviewUrl } = require("../../lib/preview-host-guard");
const { conditionalUpdate, insertRow, recordEvent, select } = require("../../lib/store");

const LINE_ROWS = "ghost_agency_line_batch_rows";
const OWNER_PROOF_ROUTE_WINDOW_MS = 285_000;
const OWNER_PROOF_PUBLIC_VERIFY_WINDOW_MS = 60_000;

let defaultSharedPublisher = null;

async function verifyActivePublicRelease(input) {
  if (!defaultSharedPublisher) {
    const { createDefaultSharedSitePublisher } = require("../../lib/shared-site-publisher");
    defaultSharedPublisher = createDefaultSharedSitePublisher();
  }
  return defaultSharedPublisher.verifyActiveRelease(input);
}

function publicReleaseMatchesIdentity(receipt, identity) {
  const proof = identity && identity.proofIdentity;
  return Boolean(
    receipt && receipt.ok === true && receipt.fallback === false
    && sanitizePreviewUrl(receipt.previewUrl) === sanitizePreviewUrl(identity.previewUrl)
    && String(receipt.siteId || "") === String(proof && proof.site_id || "")
    && String(receipt.releaseId || "") === String(proof && proof.release_id || "")
    && String(receipt.buildHash || "").toLowerCase()
      === String(identity && identity.buildHash || "").toLowerCase()
  );
}

/**
 * The live site for this prospect, whichever lane built it.
 *
 * This only ever looked at record.forge_job — the SiteForge lane. Everything the
 * MIRROR lane builds writes its address to preview_url instead, so every mirror
 * (RiverCity included) answered "no_completed_mirror" and could not be emailed
 * at all: a finished, gate-passed, aliased site that the send path could not
 * see. The two lanes are asked in order, and the mirror lane's URL goes through
 * the same host guard the line uses, so a non-wss host can never be emailed.
 */
function mirrorAliasOf(prospect) {
  const record = prospect && typeof prospect.record === "object" ? prospect.record : {};
  const job = record.forge_job;
  if (job && job.stage === "done") {
    const alias = job.deploy && typeof job.deploy.alias === "string" ? job.deploy.alias.trim() : "";
    if (/^https:\/\//i.test(alias)) return alias;
  }
  for (const candidate of [prospect && prospect.preview_url, record.preview_url]) {
    const safe = sanitizePreviewUrl(String(candidate || "").trim());
    if (safe) return safe;
  }
  return "";
}

function sunsetDate(days = 7) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function createSendMirrorProofHandler(overrides = {}) {
  const deps = {
    select: overrides.select || select,
    insertRow: overrides.insertRow || insertRow,
    conditionalUpdate: overrides.conditionalUpdate || conditionalUpdate,
    recordEvent: overrides.recordEvent || recordEvent,
    sendSequenceStep: overrides.sendSequenceStep || sendSequenceStep,
    outreachBuildQuality: overrides.outreachBuildQuality || outreachBuildQuality,
    verifyActiveRelease: overrides.verifyActiveRelease || verifyActivePublicRelease,
    now: overrides.now || (() => new Date()),
    routeNow: overrides.routeNow || Date.now,
  };

  return async function handler(req, res) {
    const routeStartedAt = deps.routeNow();
    const routeDeadlineAt = routeStartedAt + OWNER_PROOF_ROUTE_WINDOW_MS;
    const publicVerifyDeadlineAt = Math.min(
      routeStartedAt + OWNER_PROOF_PUBLIC_VERIFY_WINDOW_MS,
      routeDeadlineAt,
    );
    if (!methodGuard(req, res, ["POST"])) return;
    if (!requireAdmin(req, res)) return;
    try {
    const body = await readJson(req).catch(() => ({}));
    const id = String(body.prospectId || body.prospect_id || "").trim();
    if (!id) return sendJson(res, 400, { ok: false, error: "prospect_id_required" });

    const result = await deps.select(
      "ghost_agency_prospects",
      `?select=*&prospect_id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    const row = result?.ok && Array.isArray(result.data) ? result.data[0] : null;
    if (!row) return sendJson(res, 404, { ok: false, error: "prospect_not_found", prospect_id: id });

    const prospect = prospectFromRow(row);
    const lineResult = await deps.select(
      LINE_ROWS,
      `?select=row_id,batch_id,prospect_id,status,payload,updated_at&prospect_id=eq.${encodeURIComponent(id)}&status=in.(ready,queued,sent)&order=updated_at.desc&limit=25`,
    ).catch(() => null);
    if (!lineResult || lineResult.ok !== true || !Array.isArray(lineResult.data)) {
      return sendJson(res, 503, {
        ok: false,
        error: "line_release_read_unavailable",
        message: "The canonical Line release could not be read. Nothing was sent.",
        prospect_id: id,
      });
    }
    const candidates = lineResult.data.map((lineRow) => ({
      lineRow,
      identity: lineArtifactIdentity(lineRow, prospect, deps.outreachBuildQuality),
    }));
    const canonical = candidates.find((candidate) => candidate.identity.ok === true);
    if (!canonical) {
      return sendJson(res, 422, {
        ok: false,
        error: "no_canonical_line_release",
        message: "This build has no matching, signed, sendable Line release. Nothing was sent.",
        prospect_id: id,
      });
    }
    const identity = canonical.identity;
    const previewUrl = identity.previewUrl;

    // The owner-proof recipient gate in lib/email.js is a final ASSERTION, not a
    // redirect: it requires `to` to already equal GHOST_AGENCY_OWNER_EMAIL with
    // no cc/bcc, and blocks otherwise. So the recipient is set to the owner here
    // rather than relying on the gate to rewrite it — the gate then confirms
    // this route did the right thing instead of silently fixing it.
    const owner = String(process.env.GHOST_AGENCY_OWNER_EMAIL || "").trim();
    if (!owner) {
      return sendJson(res, 422, {
        ok: false,
        error: "owner_email_unconfigured",
        message: "GHOST_AGENCY_OWNER_EMAIL is not set. Nothing was sent.",
        prospect_id: id,
      });
    }

    // A signed historical row is not proof that its hostname still serves that
    // release. Re-read the active registry and exact public bytes before the
    // durable claim, so a stale, reassigned, redirected, or static host creates
    // no event and reaches no email provider. Dry runs use this same gate.
    const publicRelease = await deps.verifyActiveRelease({
      proofIdentity: identity.proofIdentity,
      releaseEvidence: identity.sharedReleaseEvidence,
      previewUrl,
      deadlineAt: publicVerifyDeadlineAt,
    }).catch(() => null);
    if (!publicReleaseMatchesIdentity(publicRelease, identity)) {
      return sendJson(res, 503, {
        ok: false,
        error: "owner_proof_public_release_unavailable",
        message: "The exact public release is not live. Nothing was sent.",
        prospect_id: id,
        preview_url: previewUrl,
        ...(publicRelease && publicRelease.reason
          ? { detail: String(publicRelease.reason).slice(0, 120) }
          : {}),
      });
    }

    const sendProspect = {
      ...prospect,
      email: owner,
      ownerEmail: owner,
      owner_email: owner,
      preview_url: previewUrl,
      report_url: prospect.report_url || `${previewUrl.replace(/\/+$/, "")}/`,
    };

    const delivery = await deliverOwnerProof({
      identity,
      owner,
      dryRun: body.dryRun === true,
      sendInput: {
      prospect: sendProspect,
      sequence: 1,
      step: 1,
      vars: {
        sunset_date: sunsetDate(),
        attested_current_website:
          prospect.current_website
          || prospect.record?.current_website
          || ((prospect.record?.forge_job?.input?.source_urls || []).find((u) => /^https?:\/\//i.test(String(u || ""))) || ""),
      },
      // Delivery goes to the configured owner, never the prospect.
      internalOwnerProof: true,
      // Gallery sends are the same signed owner-only Practice proof as the
      // automatic Line lane. Keep them on the Signal/V3 composer even when a
      // legacy V2 dark-launch flag is enabled.
      lineBatchApproved: true,
      requireSignalReportInEmail: true,
      // Start the business deadline at route entry and leave fifteen seconds
      // below Vercel's 300-second function cap.
      deadlineAt: routeDeadlineAt,
      // This is an owner proof, not outreach — the prospect drip stays paused.
      allowDeliveryPauseBypass: true,
      allowReviewHoldBypass: true,
      // The contact-confidence hold protects a business's ADDRESS from being
      // written to. This route never writes to it: internalOwnerProof replaces
      // the recipient with the owner and the send is then refused unless the
      // resolved address is already his. So the hold was blocking the owner
      // from looking at his own work over an address the message does not use
      // — measured at 5 of the 80 built mirrors on 2026-08-11.
      //
      // This cannot widen into a prospect send. canBypassContactHold() requires
      // all three of the flag, internalOwnerProof, and `to` already equalling
      // GHOST_AGENCY_OWNER_EMAIL; the flag alone grants nothing.
      allowContactHoldBypass: true,
      },
      deps,
    });
    const sent = delivery.receipt;

    // deliverOwnerProof promotes its pre-provider claim to the Gallery's proof
    // event only after the provider receipt is durably stored.
    const delivered = delivery.ok === true && delivery.dryRun !== true;
    const recorded = delivered;

    // SNAPSHOT INSURANCE at the moment we email (owner asset strategy). The
    // pitch hotlinks the prospect's own image URLs; the instant we put this
    // business in front of a buyer, those photographs are worth insuring, so a
    // prospect who cancels their old host before they sign up can still be
    // localized from OUR copy (lib/asset-ownership.snapshotReferencedAssets, run
    // off-path by scripts/snapshot-assets.js / a drain worker reading this
    // event). Recorded here — not run here — so a slow image host never sits on
    // the send response; flag-gated (default off) and, like the record above,
    // written after the send and never allowed to fail a message already gone.
    let snapshot = { mode: "disabled" };
    if (delivered && delivery.replay !== true && String(process.env.ASSET_SNAPSHOT_ENABLED || "").trim() === "true") {
      const requested = await deps.recordEvent("ghost_agency_asset_snapshot_requested", {
        prospect_id: id,
        business_name: prospect.business_name || "",
        preview_url: previewUrl,
        current_website:
          ((prospect.record?.forge_job?.input?.source_urls || []).find((u) => /^https?:\/\//i.test(String(u || "")))) || "",
        at: new Date().toISOString(),
      }).catch(() => null);
      snapshot = requested?.mode === "live_write" ? { mode: "requested" } : { mode: "request_unconfirmed" };
    }

    const statusCode = delivery.ok === true
      ? 200
      : ["owner_proof_in_flight", "owner_proof_reconciliation_required"].includes(delivery.reason)
        ? 409
        : /(?:unavailable|persist_failed)$/.test(String(delivery.reason || ""))
          ? 503
          : 422;
    return sendJson(res, statusCode, {
      ok: delivery.ok === true,
      prospect_id: id,
      business_name: prospect.business_name || "",
      preview_url: previewUrl,
      recorded,
      snapshot,
      send: sent,
      idempotent: delivery.replay === true,
      ...(delivery.reason ? { error: delivery.reason } : {}),
      ...(delivery.manualReconciliationRequired === true ? { manual_reconciliation_required: true } : {}),
    });
    } catch (error) {
      handleError(res, error);
    }
  };
}

module.exports = createSendMirrorProofHandler();
module.exports.createSendMirrorProofHandler = createSendMirrorProofHandler;
module.exports.mirrorAliasOf = mirrorAliasOf;
module.exports.publicReleaseMatchesIdentity = publicReleaseMatchesIdentity;
