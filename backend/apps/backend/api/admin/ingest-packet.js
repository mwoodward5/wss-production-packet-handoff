"use strict";

/**
 * POST /api/admin/ingest-packet
 *
 * Accepts a raw forwarded Genie packet email body and, optionally, the
 * prospect_id of the row to update. When prospect_id is omitted the handler
 * searches by business name + city from the packet's own `facts` object and
 * returns a dry-run result if no unique match is found.
 *
 * Body (JSON):
 *   {
 *     email_body:  string,   // raw forwarded email text (required)
 *     prospect_id: string,   // optional; if absent a search is attempted
 *     packet_dir:  string,   // optional; override the packetDir base path
 *   }
 *
 * Response (200):
 *   {
 *     ok: true,
 *     prospectId: string,
 *     packetDir:  string,
 *     patch:      object,    // fields written to the record column
 *     droppedNap: string[],  // NAP keys found in packet but refused
 *     droppedTrust: string[],
 *     mode: "live" | "dry_run",
 *   }
 *
 * CONSENT LAWS: this endpoint only ENRICHES. It never sets a consent flag,
 * never sends an email, never triggers any outbound action.
 */

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { select, upsertRow } = require("../../lib/store");
const { ingestPacketEmail } = require("../../lib/packet-ingester");
const { bridgePacketToLane, recordPatch } = require("../../lib/packet-bridge");
const { createContentCertification } = require("../../lib/intake-genie-client");

const PROSPECTS = "ghost_agency_prospects";

// -------------------------------------------------------------------
// Lookup helpers
// -------------------------------------------------------------------

/**
 * Try to find a unique prospect by name + city from the packet hint.
 * Returns { prospectId } on a unique match or null.
 */
async function findByHint(hint, deps = {}) {
  const read = deps.select || select;
  const name = String(hint.name || "").trim().toLowerCase();
  const city = String(hint.city || "").trim().toLowerCase();
  if (!name) return null;

  const result = await read(PROSPECTS, `business_name.ilike.%${name}%`).catch(() => null);
  if (!result || !result.ok || !Array.isArray(result.data) || !result.data.length) return null;

  // Narrow by city when both are known.
  const pool = city
    ? result.data.filter((r) => String(r.city || "").trim().toLowerCase() === city)
    : result.data;

  return pool.length === 1 ? pool[0].prospect_id || pool[0].id : null;
}

// -------------------------------------------------------------------
// Core handler factory (injectable deps for tests)
// -------------------------------------------------------------------

function createIngestPacketHandler(overrides = {}) {
  return async function handler(req, res) {
    if (!methodGuard(req, res, ["POST"])) return;
    const checkAdmin = overrides.requireAdmin || requireAdmin;
    if (!checkAdmin(req, res)) return;

    try {
      const body = await readJson(req).catch(() => ({}));
      const emailBody = String(body.email_body || "").trim();
      if (!emailBody) {
        sendJson(res, 400, { ok: false, error: "email_body_required" });
        return;
      }

      // 1. Ingest: parse the email and write the packet to disk.
      const ingestOpts = {};
      if (body.packet_dir) ingestOpts.baseDir = String(body.packet_dir);
      const ingest = (overrides.ingestPacketEmail || ingestPacketEmail)(emailBody, ingestOpts);
      if (!ingest.ok) {
        sendJson(res, 422, { ok: false, error: ingest.reason, detail: ingest.detail || null });
        return;
      }

      // 2. Bridge: map packet to lane record patch.
      const bridge = (overrides.bridgePacketToLane || bridgePacketToLane)(ingest.packet, {
        packetDir: ingest.packetDir,
      });
      if (!bridge.ok) {
        sendJson(res, 422, { ok: false, error: bridge.reason });
        return;
      }

      // 3. Resolve prospect_id — explicit or by hint search.
      let prospectId = String(body.prospect_id || "").trim();
      if (!prospectId) {
        prospectId = await findByHint(ingest.prospectHint, overrides) || "";
      }

      // 4. Without a prospect_id we return a dry-run so the operator can
      //    confirm which row to update before any write occurs.
      if (!prospectId) {
        sendJson(res, 200, {
          ok: true,
          mode: "dry_run",
          reason: "prospect_not_identified",
          hint: ingest.prospectHint,
          packetDir: ingest.packetDir,
          patch: bridge.patch,
          droppedNap: bridge.droppedNap,
          droppedTrust: bridge.droppedTrust,
        });
        return;
      }

      // 5. Load existing row to merge record carefully.
      const read = overrides.select || select;
      const existing = await read(PROSPECTS, `prospect_id.eq.${prospectId}`).catch(() => null);
      const currentRow = existing && existing.ok && Array.isArray(existing.data) && existing.data[0]
        ? existing.data[0]
        : {};
      if (!currentRow.prospect_id || String(currentRow.prospect_id) !== prospectId) {
        sendJson(res, 409, { ok: false, error: "prospect_identity_mismatch" });
        return;
      }
      const currentRecord = currentRow.record && typeof currentRow.record === "object"
        ? currentRow.record
        : {};

      // 6. Merge — NAP and trust in the existing row are never touched.
      const mergedRecord = recordPatch(currentRecord, bridge);
      // A bare legacy boolean is not a certificate. Bind the exact canonical
      // packet to this independently identified prospect and sign the receipt
      // before the packet can fast-pass CONTENT completeness at line pickup.
      // Logo and email are intentionally absent from this certification: the
      // logo ladder handles absence, sandbox may build without an address, and
      // live delivery keeps its own independent recipient gate.
      delete mergedRecord.genie_build_certified;
      const certify = overrides.createContentCertification || createContentCertification;
      const certification = certify(
        ingest.packet,
        { ...currentRecord, ...currentRow, prospect_id: prospectId },
        {
          signingKey: overrides.certificationKey,
          packetLocation: "prospect_record:genie_canonical_packet",
          requestId: ingest.packet.request_id || ingest.packet.job_id,
          jobId: ingest.packet.job_id,
          idempotencyKey: ingest.packet.idempotency_key || ingest.packet.request_id || ingest.packet.job_id,
          requestSources: ingest.packet.request?.sources || ingest.packet.sources,
        },
      );
      if (!certification.ok) {
        sendJson(res, 422, {
          ok: false,
          error: "genie_content_certification_failed",
          reasons: certification.reasons,
        });
        return;
      }
      mergedRecord.genie_canonical_packet = ingest.packet;
      mergedRecord.genie_compile_sources = ingest.packet.request?.sources || ingest.packet.sources;
      mergedRecord.genie_compile_idempotency_key = ingest.packet.idempotency_key
        || ingest.packet.request_id
        || ingest.packet.job_id;
      mergedRecord.genie_content_certification = certification.receipt;
      // Compatibility display only. Admission verifies the signed receipt;
      // this boolean alone grants nothing.
      mergedRecord.genie_build_certified = true;

      // Top-level columns that the query layer exposes directly.
      const rowPatch = {
        prospect_id: prospectId,
        record: mergedRecord,
        updated_at: new Date().toISOString(),
      };

      // 7. Upsert.
      const upsert = overrides.upsertRow || upsertRow;
      await upsert(PROSPECTS, rowPatch, "prospect_id");

      sendJson(res, 200, {
        ok: true,
        mode: "live",
        prospectId,
        packetDir: ingest.packetDir,
        businessName: ingest.businessName,
        patch: bridge.patch,
        droppedNap: bridge.droppedNap,
        droppedTrust: bridge.droppedTrust,
        contentCertified: true,
        certificationBlocked: [],
      });
    } catch (err) {
      handleError(res, err);
    }
  };
}

const handler = createIngestPacketHandler();
module.exports = handler;
module.exports.createIngestPacketHandler = createIngestPacketHandler;
