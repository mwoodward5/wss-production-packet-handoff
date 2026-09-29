"use strict";

const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { mergeSafePlan } = require("../../lib/prospect-identity");
const { wakeNewestBuildingPracticeBatch } = require("../../lib/line-packet-wakeup");
const store = require("../../lib/store");
const {
  bodySha256,
  buildTruthPacket,
  contractError,
  leadToProspect,
  readExactRawBody,
  validateLeadBatch,
  validateLeadMinerHeaders,
  verifyLeadMinerSignature,
} = require("../../lib/leadminer-webhook");

const RECEIPT_EVENT_TYPE = "leadminer.mirror_ready.received";

function isUniqueConflict(result = {}) {
  return Number(result.status) === 409 || String(result.error?.code || "") === "23505";
}

function liveWrite(result = {}, acceptedMode) {
  return result?.mode === acceptedMode;
}

function requireReadable(result, label) {
  if (result?.ok !== true || !Array.isArray(result.data)) {
    throw contractError(503, "leadminer_storage_unavailable", `${label} could not be read`);
  }
  return result.data;
}

function receiptId(projectId, idempotencyKey) {
  return `leadminer:${bodySha256(`${projectId}\0${idempotencyKey}`)}`;
}

async function findReceipt(eventId, storeApi = store) {
  const result = await storeApi.select(
    "ghost_agency_events",
    `select=svix_id,type,payload,created_at&svix_id=eq.${encodeURIComponent(eventId)}&limit=1`,
  );
  return requireReadable(result, "LeadMiner receipt")[0] || null;
}

function assertReceiptMatches(receipt, payloadHash) {
  const previousHash = String(receipt?.payload?.payload_sha256 || "");
  if (!previousHash || previousHash !== payloadHash) {
    throw contractError(
      409,
      "leadminer_idempotency_payload_mismatch",
      "Idempotency key was already used for a different payload",
    );
  }
}

async function findProspectById(prospectId, storeApi = store) {
  if (!prospectId) return null;
  const result = await storeApi.select(
    "ghost_agency_prospects",
    `select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
  );
  return requireReadable(result, "Ghost prospect")[0] || null;
}

async function findProspectByPlace(placeId, storeApi = store) {
  const result = await storeApi.select(
    "ghost_agency_prospects",
    `select=*&canonical_place_id=eq.${encodeURIComponent(placeId)}&limit=1`,
  );
  return requireReadable(result, "Ghost prospect identity")[0] || null;
}

async function findIdentityOwner(placeId, storeApi = store) {
  const identityKey = `place:${placeId}`;
  const result = await storeApi.select(
    "ghost_agency_prospect_identity_keys",
    `select=identity_key,canonical_prospect_id&identity_key=eq.${encodeURIComponent(identityKey)}&limit=1`,
  );
  return requireReadable(result, "Ghost identity registry")[0]?.canonical_prospect_id || "";
}

async function resolveProspect(placeId, storeApi = store) {
  const registryOwnerId = await findIdentityOwner(placeId, storeApi);
  if (registryOwnerId) {
    return {
      prospectId: registryOwnerId,
      existing: await findProspectById(registryOwnerId, storeApi),
      identitySource: "place_registry",
    };
  }

  const byPlace = await findProspectByPlace(placeId, storeApi);
  if (!byPlace) return { prospectId: "", existing: null, identitySource: "new" };
  const canonicalId = byPlace.merged_into_prospect_id
    || byPlace.canonical_prospect_id
    || byPlace.prospect_id;
  if (canonicalId === byPlace.prospect_id) {
    return { prospectId: canonicalId, existing: byPlace, identitySource: "prospect_place_id" };
  }
  return {
    prospectId: canonicalId,
    existing: await findProspectById(canonicalId, storeApi),
    identitySource: "prospect_canonical_pointer",
  };
}

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function persistedRow(prospect, existing, lead) {
  const {
    handoff,
    truth_packet: _truthPacket,
    truth_packet_source: _truthPacketSource,
    blocked_reason: _blockedReason,
    ...incoming
  } = prospect;
  if (!existing) return { row: incoming, handoff };

  const existingRecord = existing.record && typeof existing.record === "object" && !Array.isArray(existing.record)
    ? existing.record
    : {};
  const incomingRecord = incoming.record && typeof incoming.record === "object" && !Array.isArray(incoming.record)
    ? incoming.record
    : {};
  const existingFlat = {
    ...existingRecord,
    ...existing,
    place_id: existing.canonical_place_id || existingRecord.place_id || lead.place_id,
  };
  const incomingFlat = {
    ...incomingRecord,
    ...incoming,
    place_id: lead.place_id,
  };
  const mergePlan = mergeSafePlan(existingFlat, incomingFlat);
  const record = {
    ...incomingRecord,
    status: existing.status || "held",
    source: existingRecord.source || incomingRecord.source,
  };

  for (const field of [
    "business_name", "owner_name", "email", "owner_email", "phone", "current_website",
    "address", "city", "state", "postal_code", "industry", "preview_url", "report_url",
  ]) {
    if (present(existingRecord[field])) record[field] = existingRecord[field];
  }
  if (mergePlan.conflicts.length) {
    record.leadminer_identity_conflicts = mergePlan.conflicts;
    record.outreach_review_hold = true;
    record.outreach_hold_reasons = [
      ...new Set([
        ...(Array.isArray(record.outreach_hold_reasons) ? record.outreach_hold_reasons : []),
        "leadminer_identity_conflict",
      ]),
    ];
  }

  const row = {
    ...incoming,
    prospect_id: existing.prospect_id || incoming.prospect_id,
    canonical_prospect_id: existing.canonical_prospect_id
      || existing.merged_into_prospect_id
      || existing.prospect_id
      || incoming.prospect_id,
    canonical_place_id: lead.place_id,
    status: existing.status || "held",
    business_name: existing.business_name || incoming.business_name,
    source: existing.source || incoming.source,
    primary_services: [
      ...new Set([
        ...(Array.isArray(existing.primary_services) ? existing.primary_services : []),
        ...(Array.isArray(incoming.primary_services) ? incoming.primary_services : []),
      ]),
    ],
    record,
  };

  for (const field of ["email", "phone", "current_website", "industry", "city", "state"]) {
    delete row[field];
    if (present(existing[field])) row[field] = existing[field];
    else if (!present(existingFlat[field]) && present(incoming[field])) row[field] = incoming[field];
  }
  return { row, handoff, mergePlan };
}

async function persistLead(lead, context, storeApi = store) {
  let resolution = await resolveProspect(lead.place_id, storeApi);
  const build = () => {
    const prospect = leadToProspect(lead, {
      ...context,
      existingProspectId: resolution.prospectId || undefined,
      existingRecord: resolution.existing?.record,
      existingStatus: resolution.existing?.status,
    });
    return persistedRow(prospect, resolution.existing, lead);
  };

  let prepared = build();
  let persisted = await storeApi.upsertRow("ghost_agency_prospects", prepared.row, "prospect_id");
  if (isUniqueConflict(persisted)) {
    const retriedResolution = await resolveProspect(lead.place_id, storeApi);
    if (retriedResolution.prospectId && retriedResolution.prospectId !== prepared.row.prospect_id) {
      resolution = retriedResolution;
      prepared = build();
      persisted = await storeApi.upsertRow("ghost_agency_prospects", prepared.row, "prospect_id");
    }
  }

  if (!liveWrite(persisted, "live_upsert")) {
    return {
      ok: false,
      place_id: lead.place_id,
      prospect_id: prepared.row.prospect_id,
      state: isUniqueConflict(persisted) ? "identity_conflict" : "storage_failed",
      error: persisted?.error?.code || persisted?.mode || "upsert_failed",
    };
  }
  return {
    ok: true,
    place_id: lead.place_id,
    prospect_id: prepared.row.prospect_id,
    state: prepared.handoff.state,
    build_ready: prepared.handoff.buildReady,
    missing_build_evidence: prepared.handoff.missing,
  };
}

async function insertReceipt(eventId, metadata, results, storeApi = store) {
  const event = {
    type: RECEIPT_EVENT_TYPE,
    svix_id: eventId,
    payload: {
      ...metadata,
      accepted: results.length,
      prospect_ids: results.map((result) => result.prospect_id),
      ready_for_build: results.filter((result) => result.build_ready).length,
      held_incomplete: results.filter((result) => !result.build_ready).length,
      results,
      completed_at: new Date().toISOString(),
    },
    created_at: new Date().toISOString(),
  };
  const inserted = await storeApi.insertRow("ghost_agency_events", event);
  if (liveWrite(inserted, "live_write")) return { duplicate: false };
  if (isUniqueConflict(inserted)) {
    const receipt = await findReceipt(eventId, storeApi);
    if (!receipt) {
      throw contractError(503, "leadminer_storage_unavailable", "LeadMiner receipt conflict could not be resolved");
    }
    assertReceiptMatches(receipt, metadata.payload_sha256);
    return { duplicate: true };
  }
  throw contractError(503, "leadminer_storage_unavailable", "LeadMiner receipt could not be saved");
}

function zeroSideEffects() {
  return {
    provider_calls: 0,
    builds_started: 0,
    sends: 0,
    sends_performed: 0,
    publishes: 0,
  };
}

function duplicateQueueWake() {
  return { accepted: false, reason: "duplicate_receipt" };
}

async function wakeLineAfterReceipt() {
  try {
    return await wakeNewestBuildingPracticeBatch();
  } catch {
    // The durable receipt is already committed. The */2 cron is the recovery
    // path, so queue trouble must never turn an accepted packet into a retry.
    return { accepted: false, recovery: "cron", reason: "line_queue_wake_failed" };
  }
}

async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  try {
    const headers = validateLeadMinerHeaders(req.headers || {});
    const rawBody = await readExactRawBody(req);
    const verification = verifyLeadMinerSignature({
      rawBody,
      signature: headers.signature,
      timestamp: headers.timestamp,
      secret: process.env.GHOST_AGENCY_LEADMINER_WEBHOOK_SECRET,
    });
    if (!verification.configured) {
      sendJson(res, 503, { ok: false, error: "leadminer_webhook_not_configured" });
      return;
    }
    if (!verification.verified) {
      sendJson(res, 401, { ok: false, error: "leadminer_signature_invalid", message: verification.reason });
      return;
    }

    let parsed;
    try { parsed = JSON.parse(rawBody.toString("utf8")); }
    catch { throw contractError(400, "leadminer_json_invalid", "LeadMiner payload must be valid JSON"); }
    const leads = validateLeadBatch(parsed);
    const capturedAt = new Date().toISOString();
    const payloadHash = bodySha256(rawBody);
    const eventId = receiptId(headers.projectId, headers.idempotencyKey);
    const existingReceipt = await findReceipt(eventId);
    if (existingReceipt) {
      assertReceiptMatches(existingReceipt, payloadHash);
      sendJson(res, 200, {
        ok: true,
        accepted: true,
        duplicate: true,
        delivery_id: headers.deliveryId,
        idempotency_key: headers.idempotencyKey,
        queue_wake: duplicateQueueWake(),
        ...zeroSideEffects(),
      });
      return;
    }

    const metadata = {
      source: "leadminer_mirror_ready",
      event: headers.event,
      project_id: headers.projectId,
      delivery_id: headers.deliveryId,
      idempotency_key: headers.idempotencyKey,
      schema_version: headers.schemaVersion,
      payload_sha256: payloadHash,
      count: leads.length,
      received_at: capturedAt,
      ...zeroSideEffects(),
    };
    const results = [];
    for (const lead of leads) {
      results.push(await persistLead(lead, {
        capturedAt,
        projectId: headers.projectId,
        deliveryId: headers.deliveryId,
        idempotencyKey: headers.idempotencyKey,
        schemaVersion: headers.schemaVersion,
      }));
    }
    const failed = results.filter((result) => !result.ok);
    if (failed.length) {
      sendJson(res, 503, {
        ok: false,
        error: "leadminer_partial_persistence",
        delivery_id: headers.deliveryId,
        results,
        ...zeroSideEffects(),
      });
      return;
    }

    const receipt = await insertReceipt(eventId, metadata, results);
    const queueWake = receipt.duplicate
      ? duplicateQueueWake()
      : await wakeLineAfterReceipt();
    sendJson(res, 200, {
      ok: true,
      accepted: true,
      duplicate: receipt.duplicate,
      delivery_id: headers.deliveryId,
      idempotency_key: headers.idempotencyKey,
      count: results.length,
      ready_for_build: results.filter((result) => result.build_ready).length,
      held_incomplete: results.filter((result) => !result.build_ready).length,
      results,
      queue_wake: queueWake,
      ...zeroSideEffects(),
    });
  } catch (error) {
    handleError(res, error);
  }
}

handler.buildTruthPacket = buildTruthPacket;
handler.leadToProspect = leadToProspect;
handler.validateLeadBatch = validateLeadBatch;
handler.validateLeadMinerHeaders = validateLeadMinerHeaders;
handler.verifyLeadMinerSignature = verifyLeadMinerSignature;
handler._test = {
  assertReceiptMatches,
  findIdentityOwner,
  findProspectByPlace,
  findProspectById,
  findReceipt,
  insertReceipt,
  persistLead,
  persistedRow,
  receiptId,
  resolveProspect,
  wakeLineAfterReceipt,
};

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
