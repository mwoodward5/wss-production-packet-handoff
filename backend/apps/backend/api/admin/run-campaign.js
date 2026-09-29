"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { randomUUID } = require("node:crypto");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { sendSequenceStep } = require("../../lib/email");
const { isOwnerProofEmailRecord } = require("../../lib/prospect-detail");
const { prospectFromRow } = require("../../lib/prospects");
const { event, select } = require("../../lib/store");
const { ownerSandboxAddress, forceOwnerRecipient, assertOwnerOnly } = require("../../lib/sandbox-send");
const {
  dedupeProspects,
  durableClaimProspectSend,
  durableEligibility,
  finishDurableProspectSend,
  releaseDurableProspectSend,
  stableIdentity,
} = require("../../lib/outreach-identity-guard");

const DAY = 86400e3;
const CADENCE = { 2: 5 * DAY, 3: 14 * DAY };

function nextStep(logRows) {
  const sent = logRows.filter((r) => r.sequence === 1 && !r.suppressed).map((r) => r.step);
  if (logRows.some((r) => r.suppressed)) return { step: null, reason: "suppressed" };
  if (!sent.includes(1)) return { step: 1, dueAt: 0 };
  const first = logRows.find((r) => r.sequence === 1 && r.step === 1);
  const step1At = first && first.sent_at ? new Date(first.sent_at).getTime() : Date.now();
  for (const step of [2, 3]) if (!sent.includes(step)) return { step, dueAt: step1At + CADENCE[step] };
  return { step: null, reason: "sequence_complete" };
}

function countReason(target, reason) {
  const key = String(reason || "unknown");
  target[key] = (target[key] || 0) + 1;
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJson(req).catch(() => ({}));
    const dryRun = body.dryRun !== false;
    const sandboxMode = body.sandboxMode === true;

    // This legacy route has no durable Line batch or typed owner approval to
    // bind a prospect send to. Keep its previews and owner-only sandbox mode,
    // but make /api/admin/line the single authority for all live delivery.
    if (!dryRun && !sandboxMode) {
      sendJson(res, 409, {
        ok: false,
        mode: "live_blocked",
        blocker: "live_campaign_requires_line_approval",
        message: "Live prospect delivery is available only through /api/admin/line after the owner types the exact batch id to approve it.",
        sent: 0,
      });
      return;
    }

    const sandboxOwner = sandboxMode ? ownerSandboxAddress() : "";
    if (sandboxMode && !sandboxOwner) {
      sendJson(res, 200, {
        ok: false,
        mode: "sandbox_blocked",
        blocker: "sandbox_owner_email_unconfigured",
        note: "Sandbox mode requires GHOST_AGENCY_OWNER_EMAIL. Nothing was sent.",
      });
      return;
    }

    const batch = Math.min(Math.max(parseInt(body.batch, 10) || 10, 1), 100);
    const includeHtml = body.includeHtml === true;
    const runId = String(body.runId || `campaign_${randomUUID()}`);
    if (includeHtml && (!dryRun || batch > 10)) {
      sendJson(res, 400, { ok: false, error: "html_preview_requires_dry_run_batch_10_or_less" });
      return;
    }

    const prospectIds = Array.isArray(body.prospectIds)
      ? body.prospectIds.map((id) => String(id || "").trim()).filter(Boolean).slice(0, batch)
      : [];
    const started = Date.now();
    const idFilter = prospectIds.length
      ? `&prospect_id=in.(${prospectIds.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",")})`
      : "";
    const candidateLimit = prospectIds.length ? batch : Math.min(300, batch * 3);
    const rowsResult = await select(
      "ghost_agency_prospects",
      `?select=*&status=in.(reported,packeted,previewed)${idFilter}&limit=${candidateLimit}`,
    );
    if (!rowsResult.ok) {
      sendJson(res, 200, { ok: false, mode: "schema_blocked", blocker: "prospects unavailable", transport: rowsResult.status || rowsResult.mode });
      return;
    }

    const rawCandidates = (rowsResult.data || []).map((row) => ({ row, prospect: prospectFromRow(row) }));
    const dedupeInput = rawCandidates.map(({ row, prospect }) => ({ ...row, ...(prospect || {}), record: row }));
    const deduped = dedupeProspects(dedupeInput);
    const acceptedKeys = new Set(deduped.accepted.map((p) => stableIdentity(p).key || `prospect:${p.prospect_id || p.id || ""}`));
    const candidates = [];
    const duplicateOut = [];
    const consumed = new Set();
    for (const item of rawCandidates) {
      const projected = { ...item.row, ...(item.prospect || {}), record: item.row };
      const identity = stableIdentity(projected);
      const key = identity.key || `prospect:${item.row.prospect_id || ""}`;
      if (!acceptedKeys.has(key) || consumed.has(key)) {
        duplicateOut.push({ prospect_id: item.row.prospect_id, skipped: `duplicate_${identity.type || "identity"}` });
        continue;
      }
      consumed.add(key);
      candidates.push(item);
      if (candidates.length >= batch) break;
    }

    const prepared = [];
    for (const { row, prospect } of candidates) {
      const email = prospect && (prospect.email || prospect.ownerEmail || prospect.owner_email);
      // In Practice (sandbox) the recipient is forced to the owner downstream
      // (forceOwnerRecipient), so a finished no-email lead should still produce
      // an owner proof — every finished site gets one. Live/dry-run behavior is
      // unchanged: !(false && …) is true, so a prospect email is still required.
      if (!email && !(sandboxMode && prospect)) {
        prepared.push({ prospect: null, prospectId: row.prospect_id, skipped: "no_email" });
        continue;
      }
      const prospectId = prospect.prospect_id || prospect.id || row.prospect_id;
      // payload is selected so owner-proof rows can be excluded below: since
      // durable owner-proof accounting, lib/email.js records proof sends to
      // the operator in this table (marked, see isOwnerProofEmailRecord), and
      // the drip must not treat a proof to the owner as a sent step to the
      // business.
      const log = await select(
        "ghost_agency_email_log",
        `?select=sequence,step,sent_at,suppressed,payload&prospect_id=eq.${encodeURIComponent(prospectId)}&order=sent_at.asc&limit=20`,
      );
      if (!log.ok || !Array.isArray(log.data)) {
        const transport = log.skipped || log.status || log.mode || "unavailable";
        await event({ type: "campaign.run", actor: "agent_13_email_sequencer", status: "failed", payload: {
          trigger: "manual_console", runId, dryRun, sandboxMode, batch,
          blocked: "ghost_agency_email_log_unavailable", prospectId, transport, sent: 0,
        }});
        sendJson(res, 200, {
          ok: false, mode: "dedup_blocked", blocker: "ghost_agency_email_log_unavailable",
          message: "Email history could not be verified. The campaign was stopped before any email was sent.",
          prospect_id: prospectId, transport, evaluated: 0, tested: 0, sent: 0,
        });
        return;
      }
      const logRows = log.data.filter((row) => !isOwnerProofEmailRecord(row));

      let durable = null;
      if (!dryRun && !sandboxMode) {
        durable = await durableEligibility(prospect);
        if (!durable.eligible) {
          prepared.push({ prospect, prospectId, logRows, skipped: durable.reason || "cooldown_blocked", durable });
          continue;
        }
      }
      prepared.push({ prospect, prospectId, logRows, durable });
    }

    const now = Date.now();
    const out = [...duplicateOut];
    let tested = 0;
    let sent = 0;
    let dedupedCount = duplicateOut.length;
    let cooldownSkipped = 0;
    let claimed = 0;
    const blockedBy = {};

    for (const preparedRow of prepared) {
      const { prospect, prospectId } = preparedRow;
      if (preparedRow.skipped) {
        if (String(preparedRow.skipped).includes("cooldown")) cooldownSkipped++;
        countReason(blockedBy, preparedRow.skipped);
        out.push({ prospect_id: prospectId, skipped: preparedRow.skipped, next_eligible_at: preparedRow.durable?.nextEligibleAt || undefined });
        continue;
      }
      const plan = nextStep(preparedRow.logRows);
      if (!plan.step) {
        countReason(blockedBy, plan.reason);
        out.push({ prospect_id: prospectId, skipped: plan.reason });
        continue;
      }
      if (plan.dueAt > now) {
        out.push({ prospect_id: prospectId, waiting_until: new Date(plan.dueAt).toISOString(), step: plan.step });
        continue;
      }

      let sendProspect = prospect;
      if (sandboxMode) {
        sendProspect = forceOwnerRecipient(prospect, sandboxOwner);
        if (!assertOwnerOnly(sendProspect, sandboxOwner)) {
          countReason(blockedBy, "sandbox_recipient_gate_failed");
          out.push({ prospect_id: prospectId, skipped: "sandbox_recipient_gate_failed" });
          continue;
        }
      }

      const liveProspectSend = !dryRun && !sandboxMode;
      const claimToken = liveProspectSend ? `${runId}:${prospectId}:${plan.step}:${randomUUID()}` : "";
      if (liveProspectSend) {
        const claim = await durableClaimProspectSend(prospect, claimToken);
        if (!claim.ok) {
          const reason = claim.reason || "send_claim_failed";
          if (reason === "cooldown_active") cooldownSkipped++;
          countReason(blockedBy, reason);
          out.push({ prospect_id: prospectId, skipped: reason, step: plan.step });
          continue;
        }
        claimed++;
      }

      let r;
      try {
        r = await sendSequenceStep({
          prospect: sendProspect,
          sequence: 1,
          step: plan.step,
          dryRun,
          internalOwnerProof: sandboxMode,
          allowReviewHoldBypass: sandboxMode,
          allowDeliveryPauseBypass: sandboxMode,
          allowContactHoldBypass: sandboxMode,
          persistCampaignLog: !sandboxMode,
          vars: {
            keyword_1: `${(prospect.primary_services || prospect.services || [])[0] || ""} ${prospect.city || ""}`.trim(),
            run_id: runId,
          },
        });
      } catch (error) {
        if (liveProspectSend) await releaseDurableProspectSend(prospect, claimToken);
        throw error;
      }

      if (liveProspectSend) {
        if (r.ok) {
          let finalized = await finishDurableProspectSend(prospect, claimToken, {
            sendId: r.id || r.messageId || r.provider_id || "",
            creativeFingerprint: r.creativeFingerprint || r.generation_fingerprint || "",
          });
          if (!finalized) {
            finalized = await finishDurableProspectSend(prospect, claimToken, {
              sendId: r.id || r.messageId || r.provider_id || "",
              creativeFingerprint: r.creativeFingerprint || r.generation_fingerprint || "",
            });
          }
          if (!finalized) {
            countReason(blockedBy, "outreach_identity_finalize_failed");
            await event({ type: "campaign.run", actor: "agent_13_email_sequencer", status: "warning", payload: {
              trigger: "manual_console", runId, prospectId, step: plan.step, warning: "outreach_identity_finalize_failed",
            }});
          }
        } else {
          await releaseDurableProspectSend(prospect, claimToken);
        }
      }

      if (r.ok && dryRun) tested++;
      else if (r.ok) sent++;
      if (r.blocked) countReason(blockedBy, r.blocked);
      const item = { prospect_id: prospectId, step: plan.step, ok: r.ok, mode: r.mode, blocked: r.blocked, subject: r.subject };
      if (includeHtml && r.ok) {
        Object.assign(item, {
          cc: r.cc, previewText: r.previewText, organic: r.organic, organicFail: r.organicFail,
          bodyPreview: r.bodyPreview, comparison: r.comparison, authorityText: r.authorityText,
          htmlPreview: r.htmlPreview, headers: r.headers,
        });
      }
      out.push(item);
    }

    await event({ type: "campaign.run", actor: "agent_13_email_sequencer", status: "ok", payload: {
      trigger: "manual_console", runId, dryRun, sandboxMode, batch, includeHtml,
      evaluated: out.length, tested, sent, deduped: dedupedCount, cooldownSkipped, claimed,
      blockedBy, durationMs: Date.now() - started,
    }});

    sendJson(res, 200, {
      ok: true, dryRun, sandboxMode,
      sandboxRecipient: sandboxMode ? sandboxOwner : undefined,
      runId, batch, includeHtml, evaluated: out.length, tested, sent,
      deduped: dedupedCount, cooldownSkipped, claimed, blockedBy, out,
      note: dryRun
        ? "DRY RUN — composed and passed compliance gates, nothing sent."
        : sandboxMode
          ? `SANDBOX — real emails delivered to the owner (${sandboxOwner}) only. No prospect was contacted.`
          : "LIVE — identity cooldown, atomic claim, email history, and compliance gates enforced before Resend delivery.",
    });
  } catch (error) {
    handleError(res, error);
  }
};
