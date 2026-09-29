"use strict";

/**
 * Gallery management: reversible by default, destructive only on purpose.
 *
 * Three actions live here, in ascending order of consequence:
 *
 *   archive / restore — the original reversible pair. The row is never
 *     deleted, only re-statused, with the previous status remembered.
 *   notes — the owner's own corrections to one record: the business name,
 *     city, state, trade, and one private free-text notes field. Only the
 *     provided fields are written; every changed field is audited.
 *   delete — permanent removal of the RECORD ROW, offered only on archived
 *     rows and only when the caller types the business name back. There is
 *     no artifact-removal precedent anywhere in this codebase (mirrors live
 *     on per-prospect Vercel projects, screenshots in the media pipeline),
 *     so delete is record-only and says so in its response: a deployed
 *     preview that still answers is not this route's to tear down.
 *
 * Nothing here sends email or touches the site-generation engine's queues.
 * Every write is admin-gated and guarded by the row status read immediately
 * before the change so a concurrent state change is reported, not
 * overwritten — the delete goes one step further and filters on
 * status=archived_legacy at the database itself, so a row that was restored
 * between the read and the delete is kept, not lost.
 */

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { conditionalUpdate, recordEvent, select } = require("../../lib/store");
const { RETIRING, RETIRED, executeRetirement, retirementRecord } = require("../../lib/site-retirement");

const TABLE = "ghost_agency_prospects";
const ARCHIVED = "archived_legacy";
const MAX_BATCH = 100;
const ACTIONS = Object.freeze(["archive", "restore", "notes", "delete"]);
const DASHBOARD_ACCESS = "ghost_agency_dashboard_access";

// The owner edits five things on a card, and nothing else. Limits exist so a
// pasted novel cannot silently become the record, and so the gallery card it
// renders back stays a card.
const NOTES_LIMITS = Object.freeze({
  business_name: 120,
  city: 120,
  state: 120,
  industry: 120,
  notes: 2000,
});
const EDITABLE_FIELDS = Object.freeze(Object.keys(NOTES_LIMITS));
// Notes live inside the record JSON under this key. The drawer's "Your notes"
// block is a different thing entirely — those are append-only events owned by
// /api/admin/prospect-note — and the two must never share a name.
const RECORD_NOTES_KEY = "private_notes";

function text(value) {
  return String(value == null ? "" : value).trim();
}

function safeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedIds(values) {
  const seen = new Set();
  const ids = [];
  for (const value of Array.isArray(values) ? values : []) {
    const id = text(value);
    if (!id || id.length > 180 || /[\u0000-\u001f\u007f]/.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_BATCH) break;
  }
  return ids;
}

function restoredStatus(record) {
  const previous = text(record.gallery_previous_status);
  if (previous && previous !== ARCHIVED) return previous;
  return "built";
}

async function changeOne({ action, prospectId, lookup, update, now }) {
  const found = await lookup(
    TABLE,
    `select=prospect_id,status,record&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
  );
  const row = found?.ok && Array.isArray(found.data) ? found.data[0] : null;
  if (!row) return { prospectId, ok: false, changed: false, reason: "website_not_found" };

  const record = safeRecord(row.record);
  const rowStatus = text(row.status);
  const current = rowStatus || text(record.status);
  const archived = current === ARCHIVED;

  if (action === "archive" && archived) {
    return { prospectId, ok: true, changed: false, reason: "already_archived" };
  }
  if (action === "restore" && !archived) {
    return { prospectId, ok: true, changed: false, reason: "already_active" };
  }

  const timestamp = now().toISOString();
  const nextStatus = action === "archive" ? ARCHIVED : restoredStatus(record);
  const nextRecord = {
    ...record,
    status: nextStatus,
    ...(action === "archive"
      ? {
          gallery_previous_status: current && current !== ARCHIVED ? current : restoredStatus(record),
          gallery_archived_at: timestamp,
        }
      : {
          gallery_archived_at: null,
          gallery_restored_at: timestamp,
        }),
  };

  const result = await update(
    TABLE,
    "prospect_id",
    prospectId,
    rowStatus ? { status: `eq.${rowStatus}` } : {},
    {
      status: nextStatus,
      record: nextRecord,
      updated_at: timestamp,
    },
  );

  if (result?.ok === true && result.updated === true) {
    return { prospectId, ok: true, changed: true, status: nextStatus };
  }
  if (result?.ok === true && result.updated === false) {
    return { prospectId, ok: false, changed: false, reason: "website_changed_while_updating" };
  }
  return {
    prospectId,
    ok: false,
    changed: false,
    reason: text(result?.error?.code || result?.mode || "update_failed"),
  };
}

// Permanent row removal. The status=archived_legacy filter rides on the DELETE
// itself, so the guard is re-evaluated by the database at delete time: a row
// restored between our read and this call is kept, not lost. This follows the
// direct PostgREST DELETE precedent in lib/connect-oauth.js because lib/store
// deliberately exports no destructive primitive.
async function deleteArchivedRow(prospectId) {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return { ok: false, mode: "not_configured", deleted: false };
  const url = `${base}/rest/v1/${TABLE}`
    + `?prospect_id=eq.${encodeURIComponent(prospectId)}`
    + `&status=eq.${ARCHIVED}`;
  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
    });
    if (!response.ok) {
      return { ok: false, mode: "live_delete_failed", status: response.status, deleted: false };
    }
    const rows = await response.json().catch(() => []);
    return {
      ok: true,
      mode: "live_delete",
      deleted: Array.isArray(rows) ? rows.length > 0 : true,
    };
  } catch (error) {
    return { ok: false, mode: "network_error", error: text(error?.message || error), deleted: false };
  }
}

// Build the "notes" patch from the request body. Returns only the fields that
// were PROVIDED (undefined means "leave alone"; an empty string for notes
// means "clear it"), validates each one, and reports what changed against the
// row we just read so the audit can name the change, not guess at it.
function buildNotesPatch(body, record) {
  const provided = {};
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) provided[field] = body[field];
  }
  if (!Object.keys(provided).length) {
    return { error: { status: 400, code: "nothing_to_update" } };
  }
  const clean = {};
  for (const [field, rawValue] of Object.entries(provided)) {
    const value = String(rawValue == null ? "" : rawValue).trim();
    const limit = NOTES_LIMITS[field];
    if (value.length > limit) {
      return {
        error: {
          status: 400,
          code: `${field}_too_long`,
          message: `${field} is capped at ${limit.toLocaleString()} characters. This one is ${value.length.toLocaleString()}.`,
        },
      };
    }
    if (field !== "notes" && /[\u0000-\u001f\u007f]/.test(value)) {
      return { error: { status: 400, code: `${field}_invalid_characters` } };
    }
    clean[field] = value;
  }

  const changes = [];
  for (const field of EDITABLE_FIELDS) {
    if (!(field in clean)) continue;
    const before = field === "notes"
      ? String(record[RECORD_NOTES_KEY] == null ? "" : record[RECORD_NOTES_KEY])
      : String(record[field] == null ? "" : record[field]);
    const after = clean[field];
    if (before === after) continue;
    changes.push({
      field,
      // The notes are the owner's private words; the audit names their length,
      // never their contents. The short identity fields are quoted as-is so a
      // bad edit can be seen and undone by hand.
      ...(field === "notes"
        ? { from_chars: before.length, to_chars: after.length }
        : { from: before.slice(0, 120), to: after.slice(0, 120) }),
    });
  }

  return { clean, changes };
}

function siteFromRecord(record) {
  return {
    businessName: text(record.business_name),
    city: text(record.city),
    state: text(record.state),
    vertical: text(record.industry),
    notes: text(record[RECORD_NOTES_KEY]),
  };
}

function createGalleryManageHandler(overrides = {}) {
  const lookup = overrides.select || select;
  const update = overrides.conditionalUpdate || conditionalUpdate;
  const audit = overrides.recordEvent || recordEvent;
  const retire = overrides.executeRetirement || executeRetirement;
  const now = overrides.now || (() => new Date());

  async function readOne(prospectId) {
    const found = await lookup(
      TABLE,
      `select=prospect_id,status,record,business_name,city,state,industry&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
    );
    const row = found?.ok && Array.isArray(found.data) ? found.data[0] : null;
    return row || null;
  }

  async function hasPaidAccess(siteSlug) {
    const slug = text(siteSlug);
    if (!slug) return { ok: false, reason: "site_slug_missing" };
    const found = await lookup(
      DASHBOARD_ACCESS,
      `select=job_id&site_slug=eq.${encodeURIComponent(slug)}&job_id=not.like.prospect-*&limit=1`,
    );
    if (!found?.ok || !Array.isArray(found.data)) return { ok: false, reason: "paid_access_unavailable" };
    return { ok: true, paid: found.data.length > 0 };
  }

  // THE OWNER'S OWN CORRECTIONS. One record, only the provided fields, one
  // audit event per field that actually changed, and the server's own record
  // returned as the truth the card re-renders from.
  async function handleNotes(body, res) {
    const prospectId = text(body.prospectId || body.prospect_id);
    if (!prospectId) {
      sendJson(res, 400, { ok: false, error: "prospect_id_required" });
      return;
    }
    const row = await readOne(prospectId);
    if (!row) {
      sendJson(res, 404, { ok: false, error: "website_not_found" });
      return;
    }
    const record = safeRecord(row.record);
    const patch = buildNotesPatch(body, record);
    if (patch.error) {
      sendJson(res, patch.error.status, {
        ok: false,
        error: patch.error.code,
        ...(patch.error.message ? { message: patch.error.message } : {}),
      });
      return;
    }
    if (!patch.changes.length) {
      // Every provided field already held that value. Not an error — the
      // record simply has nothing new to say.
      sendJson(res, 200, {
        ok: true,
        action: "notes",
        prospectId,
        changed: [],
        record,
        site: siteFromRecord(record),
      });
      return;
    }

    const timestamp = now().toISOString();
    const nextRecord = { ...record, updated_at: timestamp };
    const columns = { record: nextRecord, updated_at: timestamp };
    for (const change of patch.changes) {
      if (change.field === "notes") {
        nextRecord[RECORD_NOTES_KEY] = patch.clean.notes;
        nextRecord.gallery_notes_updated_at = timestamp;
      } else {
        nextRecord[change.field] = patch.clean[change.field];
        columns[change.field] = patch.clean[change.field];
      }
    }

    const rowStatus = text(row.status);
    const result = await update(
      TABLE,
      "prospect_id",
      prospectId,
      rowStatus ? { status: `eq.${rowStatus}` } : {},
      columns,
    );
    if (result?.ok !== true) {
      sendJson(res, 503, {
        ok: false,
        error: "notes_not_saved",
        message: "The correction could not be saved just now. Nothing was changed.",
      });
      return;
    }
    if (result.updated === false) {
      sendJson(res, 409, {
        ok: false,
        error: "website_changed_while_updating",
        message: "This record changed while you were editing. Reopen it and try again.",
      });
      return;
    }

    // One event per changed field, in the file's existing event shape, so the
    // audit trail can answer "who renamed this and from what" per field.
    for (const change of patch.changes) {
      await Promise.resolve(audit("gallery.management", {
        action: "notes",
        field: change.field,
        ...change,
        prospect_id: prospectId,
        business_name: text(nextRecord.business_name || row.business_name),
        created_at: timestamp,
      })).catch(() => null);
    }

    sendJson(res, 200, {
      ok: true,
      action: "notes",
      prospectId,
      changed: patch.changes.map((change) => change.field),
      record: nextRecord,
      site: siteFromRecord(nextRecord),
    });
  }

  // PERMANENT, AND GUARDED TWICE. The row must be archived, and the caller
  // must type the business name back — the same name the card shows, so the
  // confirmation cannot be clicked through on muscle memory. Even then the
  // DELETE filters on status=archived_legacy at the database.
  async function handleDelete(body, res) {
    const prospectId = text(body.prospectId || body.prospect_id);
    if (!prospectId) {
      sendJson(res, 400, { ok: false, error: "prospect_id_required" });
      return;
    }
    if (Array.isArray(body.prospectIds) && body.prospectIds.length > 1) {
      sendJson(res, 400, { ok: false, error: "delete_is_one_at_a_time" });
      return;
    }
    const confirmName = text(body.confirm);
    if (!confirmName) {
      sendJson(res, 400, {
        ok: false,
        error: "confirm_name_required",
        message: "Type the business name exactly as the card shows it to confirm.",
      });
      return;
    }

    const row = await readOne(prospectId);
    if (!row) {
      sendJson(res, 404, { ok: false, error: "website_not_found" });
      return;
    }
    const record = safeRecord(row.record);
    const businessName = text(record.business_name || row.business_name);
    const rowStatus = text(row.status);
    const current = rowStatus || text(record.status);

    const priorRetirement = safeRecord(record.site_retirement);
    if (current === RETIRED) {
      sendJson(res, 200, { ok: true, action: "delete", prospectId, deleted: true, idempotent: true, retirement: priorRetirement });
      return;
    }
    if (current !== ARCHIVED && current !== RETIRING) {
      sendJson(res, 409, {
        ok: false,
        error: "not_archived",
        message: "Only archived websites can be deleted forever. Archive it first — archiving is reversible, this is not.",
      });
      return;
    }
    const sameName = (left, right) => left.toLowerCase().replace(/\s+/g, " ") === right.toLowerCase().replace(/\s+/g, " ");
    if (!sameName(confirmName, businessName)) {
      sendJson(res, 400, {
        ok: false,
        error: "confirm_name_mismatch",
        message: "That does not match the business name on the card. Type it exactly to confirm.",
      });
      return;
    }

    const timestamp = now().toISOString();
    let retiringRow = row;
    if (current === ARCHIVED) {
      const prepared = retirementRecord(row, { now: new Date(timestamp), reason: "operator_delete" });
      const paid = await hasPaidAccess(prepared.slug);
      if (!paid.ok) {
        sendJson(res, 503, { ok: false, error: "paid_access_check_unavailable", message: "This website was kept because paid-client ownership could not be checked." });
        return;
      }
      if (paid.paid) {
        sendJson(res, 409, { ok: false, error: "paid_client_delete_refused", message: "This website has paid-client access evidence and cannot be retired from the inventory control." });
        return;
      }
      const nextRecord = { ...record, status: RETIRING, do_not_contact: true, suppressed: true, site_retirement: prepared };
      const marked = await update(TABLE, "prospect_id", prospectId, { status: `eq.${ARCHIVED}` }, {
        status: RETIRING,
        record: nextRecord,
        updated_at: timestamp,
      });
      if (marked?.ok !== true || marked.updated !== true) {
        sendJson(res, 409, { ok: false, error: "website_changed_while_retiring", message: "The website changed before retirement could begin. Nothing was torn down." });
        return;
      }
      retiringRow = { ...row, status: RETIRING, record: nextRecord };
    }

    const outcome = await retire(retiringRow, { now });
    const baseRetirement = safeRecord(retiringRow.record).site_retirement || priorRetirement;
    if (!outcome?.ok) {
      const pendingRecord = {
        ...safeRecord(retiringRow.record),
        status: RETIRING,
        do_not_contact: true,
        suppressed: true,
        site_retirement: { ...safeRecord(baseRetirement), state: "teardown_pending", last_error: text(outcome?.reason || "retirement_failed"), updated_at: timestamp },
      };
      await update(TABLE, "prospect_id", prospectId, { status: `eq.${RETIRING}` }, { status: RETIRING, record: pendingRecord, updated_at: timestamp });
      await Promise.resolve(audit("gallery_retirement_pending", { prospect_id: prospectId, business_name: businessName, reason: text(outcome?.reason), created_at: timestamp })).catch(() => null);
      sendJson(res, 202, { ok: true, action: "delete", prospectId, deleted: false, teardownPending: true, retirement: pendingRecord.site_retirement, message: "The website is removed from active inventory but external teardown is still pending. It will never be rebuilt while pending." });
      return;
    }

    const completedRecord = {
      ...safeRecord(retiringRow.record),
      status: RETIRED,
      do_not_contact: true,
      suppressed: true,
      site_retirement: { ...safeRecord(baseRetirement), state: RETIRED, completed_at: timestamp, receipt: outcome.receipt || {} },
    };
    const completed = await update(TABLE, "prospect_id", prospectId, { status: `eq.${RETIRING}` }, { status: RETIRED, record: completedRecord, updated_at: timestamp });
    if (completed?.ok !== true || completed.updated !== true) {
      sendJson(res, 503, { ok: false, error: "retirement_receipt_not_persisted", message: "External teardown finished but its durable retirement receipt could not be saved. The website remains blocked from rebuild." });
      return;
    }
    await Promise.resolve(audit("gallery_retired", { prospect_id: prospectId, business_name: businessName, scope: "vercel_alias_project_and_source_archive", created_at: timestamp })).catch(() => null);
    sendJson(res, 200, { ok: true, action: "delete", prospectId, deleted: true, undo: null, retirement: completedRecord.site_retirement, note: "The public legacy project, hostname, generated source archive, and future rebuild eligibility were retired. The tombstone remains to prevent resurrection." });
  }

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["POST"])) return;
    if (!requireAdmin(req, res)) return;

    try {
      const body = await readJson(req).catch(() => ({}));
      const action = text(body.action).toLowerCase();
      if (!ACTIONS.includes(action)) {
        sendJson(res, 400, { ok: false, error: "action_not_supported", supported: ACTIONS });
        return;
      }

      if (action === "notes") {
        await handleNotes(body, res);
        return;
      }
      if (action === "delete") {
        await handleDelete(body, res);
        return;
      }

      const prospectIds = normalizedIds(body.prospectIds || body.prospect_ids);
      if (!prospectIds.length) {
        sendJson(res, 400, { ok: false, error: "select_at_least_one_website" });
        return;
      }

      const results = [];
      // Sequential writes are deliberate. This is an operator action, not a
      // generation lane, and bounded ordering avoids turning one click into a
      // 100-request burst against the prospect table.
      for (const prospectId of prospectIds) {
        results.push(await changeOne({ action, prospectId, lookup, update, now }));
      }

      const changed = results.filter((entry) => entry.changed).length;
      const failed = results.filter((entry) => !entry.ok).length;
      const unchanged = results.length - changed - failed;

      await Promise.resolve(audit("gallery.management", {
        action,
        prospect_ids: prospectIds,
        changed,
        unchanged,
        failed,
        created_at: now().toISOString(),
      })).catch(() => null);

      // A partial batch is still a handled request. Per-site truth stays in
      // results, while the UI can report both changed and failed counts.
      sendJson(res, 200, {
        ok: true,
        action,
        requested: prospectIds.length,
        changed,
        unchanged,
        failed,
        results,
      });
    } catch (error) {
      handleError(res, error);
    }
  };
}

module.exports = createGalleryManageHandler();
module.exports.createGalleryManageHandler = createGalleryManageHandler;
module.exports.normalizedIds = normalizedIds;
module.exports.restoredStatus = restoredStatus;
module.exports.buildNotesPatch = buildNotesPatch;
module.exports.deleteArchivedRow = deleteArchivedRow;
