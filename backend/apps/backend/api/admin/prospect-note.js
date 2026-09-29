"use strict";

// api/admin/prospect-note.js — the operator's own words about one business.
//
// Notes are APPEND-ONLY events, not a field on the lead record. Three reasons,
// all of them bought with scar tissue in this repo:
//
//   1. Durability without a migration: ghost_agency_events already exists, is
//      already timestamped by the database, and is already the audit trail.
//      Verified 2026-08-11 that PostgREST filters it by payload key
//      (payload->>prospect_id=eq.…), so a per-prospect read is one indexed
//      query, not a table scan.
//   2. A note can never corrupt the lead. Writing into ghost_agency_prospects
//      .record means a read-modify-write, and this repo has already paid for
//      that once: prospectFromRow spreads the row, so re-saving nests the
//      whole blob one level deeper each time — 333 rows reached depth 6+, one
//      hit 21 MB. An append cannot nest anything.
//   3. Nothing is ever lost. Editing a note in place destroys what it said
//      before; appending keeps every version with the time it was written.
//
// Admin token required, POST only, note text in the body — never in a URL.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { recordEvent } = require("../../lib/store");

const NOTE_EVENT_TYPE = "operator.prospect_note";
const MAX_NOTE_LENGTH = 4000;

function createProspectNoteHandler(overrides = {}) {
  const write = overrides.recordEvent || recordEvent;
  const clock = overrides.now || (() => new Date().toISOString());

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["POST"])) return;
    if (!requireAdmin(req, res)) return;

    try {
      const body = await readJson(req).catch(() => ({}));
      const prospectId = String(body.prospectId || body.prospect_id || "").trim();
      const note = String(body.note == null ? "" : body.note).trim();

      if (!prospectId) {
        return sendJson(res, 400, { ok: false, error: "prospect_id_required" });
      }
      if (!note) {
        return sendJson(res, 400, {
          ok: false,
          error: "note_required",
          message: "Type something first — an empty note is not saved.",
        });
      }
      if (note.length > MAX_NOTE_LENGTH) {
        return sendJson(res, 400, {
          ok: false,
          error: "note_too_long",
          message: `Notes are capped at ${MAX_NOTE_LENGTH.toLocaleString()} characters. This one is ${note.length.toLocaleString()}.`,
        });
      }

      const at = clock();
      const result = await write(NOTE_EVENT_TYPE, {
        prospect_id: prospectId,
        note,
        actor: "Operator",
        at,
      });

      // A write that did not land must say so. Reporting "saved" for a note
      // that vanished is exactly the failure this console exists to end.
      // store.insertRow answers mode:"live_write" only when the database
      // accepted the row; "live_write_failed" and "dry_run" both mean the note
      // is not on disk, whatever else the response carries.
      const stored = result?.mode === "live_write" || (result?.ok === true && !result?.error);
      if (!stored) {
        return sendJson(res, 503, {
          ok: false,
          error: "note_not_saved",
          message: "The note could not be saved just now. Copy your text before leaving this page.",
        });
      }

      res.setHeader("Cache-Control", "no-store");
      return sendJson(res, 200, {
        ok: true,
        note: { when: at, who: "Operator", text: note },
      });
    } catch (error) {
      handleError(res, error);
    }
  };
}

module.exports = createProspectNoteHandler();
module.exports.createProspectNoteHandler = createProspectNoteHandler;
module.exports.NOTE_EVENT_TYPE = NOTE_EVENT_TYPE;
module.exports.MAX_NOTE_LENGTH = MAX_NOTE_LENGTH;
