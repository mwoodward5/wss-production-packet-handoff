"use strict";

// api/admin/prospect-detail.js — everything we already know about ONE business,
// for the operator drawer in /gallery.
//
// PII POSTURE, matching api/hot-leads.js:
//   * admin token required, no other caller reaches this;
//   * it is a POST, so the business identifier never lands in a URL, a
//     referrer, an access log, or a browser history entry — and neither can
//     the contact details, which exist only in the response body;
//   * no tenant/customer token grants access here; there is no read path from
//     the customer dashboard to this route;
//   * Cache-Control: no-store, so a shared machine's browser keeps no copy.
//
// It reads. It never writes, sends, builds, or changes a status.

const { requireAdmin } = require("../../lib/admin-auth");
const { deliveryPauseStatus } = require("../../lib/delivery-pause");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { PROOF_SENT_EVENT_TYPE, prospectDetail } = require("../../lib/prospect-detail");
const { select } = require("../../lib/store");

const NOTE_EVENT_TYPE = "operator.prospect_note";
const MAX_NOTES = 50;
const MAX_SENDS = 25;
const MAX_PROOFS = 25;

function createProspectDetailHandler(overrides = {}) {
  const selectRows = overrides.select || select;
  const pauseStatus = overrides.deliveryPauseStatus || deliveryPauseStatus;
  const env = overrides.env || process.env;

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["POST"])) return;
    if (!requireAdmin(req, res)) return;

    try {
      const body = await readJson(req).catch(() => ({}));
      const prospectId = String(body.prospectId || body.prospect_id || "").trim();
      if (!prospectId) {
        return sendJson(res, 400, { ok: false, error: "prospect_id_required" });
      }

      const prospectResult = await selectRows(
        "ghost_agency_prospects",
        `?select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
      );
      if (prospectResult?.ok !== true || !Array.isArray(prospectResult.data)) {
        return sendJson(res, 503, {
          ok: false,
          error: "prospect_store_unavailable",
          message: "The lead records could not be read just now. Nothing was changed.",
        });
      }
      const row = prospectResult.data[0];
      if (!row) {
        return sendJson(res, 404, { ok: false, error: "prospect_not_found", prospectId });
      }

      // The send log and the notes are separate reads on purpose: a failure in
      // either must not blank the contact details, which are the whole point of
      // the drawer. Each degrades to "we could not read this" on its own.
      const [sendResult, noteResult, proofResult, pause] = await Promise.all([
        selectRows(
          "ghost_agency_email_log",
          `?select=prospect_id,sent_at,mode,suppressed,payload&prospect_id=eq.${encodeURIComponent(prospectId)}&order=sent_at.desc&limit=${MAX_SENDS}`,
        ).catch(() => ({ ok: false })),
        selectRows(
          "ghost_agency_events",
          `?select=payload,created_at&type=eq.${encodeURIComponent(NOTE_EVENT_TYPE)}&payload->>prospect_id=eq.${encodeURIComponent(prospectId)}&order=created_at.desc&limit=${MAX_NOTES}`,
        ).catch(() => ({ ok: false })),
        // Proof sends to the owner are kept out of ghost_agency_email_log by
        // lib/email.js so they never pollute a campaign metric. This is the only
        // place they are written down, so it is the only place they can be read.
        selectRows(
          "ghost_agency_events",
          `?select=payload,created_at&type=eq.${encodeURIComponent(PROOF_SENT_EVENT_TYPE)}&payload->>prospect_id=eq.${encodeURIComponent(prospectId)}&order=created_at.desc&limit=${MAX_PROOFS}`,
        ).catch(() => ({ ok: false })),
        Promise.resolve(pauseStatus()).catch(() => ({ active: true, known: false })),
      ]);

      const emailLogRows = sendResult?.ok === true && Array.isArray(sendResult.data) ? sendResult.data : [];
      const noteEventRows = noteResult?.ok === true && Array.isArray(noteResult.data) ? noteResult.data : [];
      const proofEventRows = proofResult?.ok === true && Array.isArray(proofResult.data) ? proofResult.data : [];

      const detail = prospectDetail(row, {
        emailLogRows,
        noteEventRows,
        proofEventRows,
        sendEnv: env,
        deliveryPauseActive: pause?.active === true,
      });

      res.setHeader("Cache-Control", "no-store");
      return sendJson(res, 200, {
        ok: true,
        detail,
        // Say which parts of the drawer are a measurement and which are a
        // read that failed, so a blank history never reads as "nothing ever
        // happened" when it actually means "we could not look".
        sources: {
          sendHistoryRead: sendResult?.ok === true && proofResult?.ok === true,
          notesRead: noteResult?.ok === true,
          deliveryPauseKnown: pause?.known !== false,
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  };
}

module.exports = createProspectDetailHandler();
module.exports.createProspectDetailHandler = createProspectDetailHandler;
module.exports.NOTE_EVENT_TYPE = NOTE_EVENT_TYPE;
