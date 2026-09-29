"use strict";

const { once } = require("node:events");
const { isIP } = require("node:net");
const { mirrorHostSlug, siteUrlFromRow } = require("../../lib/customer-site");

const CALL_EVENT = "outreach.call_completed";
const RILEY_EVENT_ACTOR = "vapi.local_growth_clean";
const RILEY_ASSISTANT_FALLBACK = "5b5e73a3-2bd7-4777-8233-077bf7ffddc6";
const RETENTION_DAYS = 14;
const RETENTION_MS = RETENTION_DAYS * 86400000;
const EVENT_LIMIT = 201;
const ITEM_LIMIT = 20;
const VAPI_TIMEOUT_MS = 8_000;
const AUDIO_TIMEOUT_MS = 30_000;
const MAX_VAPI_JSON_BYTES = 5 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 100_000;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function plainObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readRows(result, source) {
  if (Array.isArray(result)) return result;
  if (!result || result.ok === false || (result.mode && result.mode !== "live_select")) {
    throw fail(503, "customer_source_unavailable", `${source} is unavailable`);
  }
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.rows)) return result.rows;
  throw fail(503, "customer_source_unavailable", `${source} is unavailable`);
}

function cleanText(value, max = 240) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/gi, "[link omitted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[contact omitted]")
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[contact omitted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function validCallId(value) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(String(value || ""));
}

function validProspectId(value) {
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(String(value || ""));
}

function eventPayload(row) {
  return plainObject(row && row.payload) || {};
}

function eventProspectId(row) {
  const payload = eventPayload(row);
  return String(payload.prospect_id || "").trim();
}

function eventCallId(row) {
  const payload = eventPayload(row);
  return String(payload.call_id || "").trim();
}

function isRileyEvent(row, cutoff, now) {
  const at = Date.parse(row && row.created_at || "");
  const payload = eventPayload(row);
  return row && row.type === CALL_EVENT
    && payload.actor === RILEY_EVENT_ACTOR
    && Number.isFinite(at)
    && at >= cutoff
    && at <= now + 5 * 60_000
    && validCallId(eventCallId(row))
    && validProspectId(eventProspectId(row));
}

function canonicalProspectSlug(row) {
  return mirrorHostSlug(siteUrlFromRow(row));
}

async function resolveProspectBinding({ prospectId, siteSlug, select }) {
  if (!validProspectId(prospectId)) return null;
  const response = await select(
    "ghost_agency_prospects",
    `select=prospect_id,preview_url,record&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=4`,
  );
  const rows = readRows(response, "prospect lookup");
  if (rows.length >= 4) throw fail(503, "customer_source_incomplete", "prospect lookup was incomplete");
  const exact = rows.filter((row) => String(row && row.prospect_id || "") === prospectId);
  if (exact.length !== 1) return null;
  return canonicalProspectSlug(exact[0]) === siteSlug ? exact[0] : null;
}

function summaryObject(row) {
  const value = eventPayload(row).summary;
  const parsed = plainObject(value);
  if (parsed) return parsed;
  return typeof value === "string" ? { notes: value } : {};
}

function humanOutcome(value) {
  const raw = String(value || "").trim().toLowerCase();
  const known = {
    booked: "Booked",
    callback_requested: "Callback requested",
    message_taken: "Message taken",
    resolved: "Resolved",
    voicemail: "Voicemail",
    opt_out: "Opted out",
    interested: "Interested",
    not_interested: "Not interested",
    no_answer: "No answer",
    other: "Call completed",
  };
  if (known[raw]) return known[raw];
  return "Call completed";
}

function finiteDuration(summary) {
  const value = Number(summary.duration_seconds ?? summary.durationSeconds ?? summary.duration);
  return Number.isFinite(value) && value >= 0 && value <= 8 * 3600 ? Math.round(value) : null;
}

function safeDirection(summary) {
  const value = String(summary.direction || "").trim().toLowerCase();
  return ["inbound", "outbound"].includes(value) ? value : "";
}

function answeredEvidence(row) {
  const summary = summaryObject(row);
  for (const value of [summary.answered, summary.was_answered, summary.call_answered]) {
    if (value === true) return true;
    if (value === false) return false;
  }
  const outcome = String(summary.outcome || summary.disposition || "").trim().toLowerCase();
  if (["no_answer", "no-answer", "voicemail", "busy", "failed", "canceled", "cancelled"].includes(outcome)) return false;
  if ([
    "booked", "callback_requested", "message_taken", "resolved", "opt_out",
    "interested", "not_interested", "connected", "answered",
  ].includes(outcome)) return true;
  return null;
}

function describeCallEvent(row) {
  const summary = summaryObject(row);
  const durationSeconds = finiteDuration(summary);
  const direction = safeDirection(summary);
  const note = cleanText(
    summary.request || summary.notes || summary.summary || summary.call_summary || summary.overview || "",
    240,
  );
  const answered = answeredEvidence(row);
  return {
    id: eventCallId(row),
    at: new Date(Date.parse(row.created_at)).toISOString(),
    outcome: humanOutcome(summary.outcome || summary.disposition),
    summary: note || "Call completed.",
    ...(answered == null ? {} : { answered }),
    ...(direction ? { direction } : {}),
    ...(durationSeconds == null ? {} : { durationSeconds }),
  };
}

async function boundedMap(values, concurrency, mapper) {
  const result = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return result;
}

async function loadTenantCalls({ siteSlug, select, now = Date.now(), fetchImpl = fetch, env = process.env }) {
  const cutoff = now - RETENTION_MS;
  const response = await select(
    "ghost_agency_events",
    `select=id,type,payload,created_at&type=eq.${CALL_EVENT}&created_at=gte.${encodeURIComponent(new Date(cutoff).toISOString())}&order=created_at.desc&limit=${EVENT_LIMIT}`,
  );
  const rows = readRows(response, "call history");
  if (rows.length >= EVENT_LIMIT) throw fail(503, "customer_source_incomplete", "call history was incomplete");

  const unique = new Map();
  for (const row of rows) {
    if (!isRileyEvent(row, cutoff, now)) continue;
    const callId = eventCallId(row);
    if (!unique.has(callId)) unique.set(callId, row);
  }
  const prospectIds = [...new Set([...unique.values()].map(eventProspectId))];
  if (prospectIds.length > 50) throw fail(503, "customer_source_incomplete", "call ownership lookup was incomplete");

  const bindings = new Map(await Promise.all(prospectIds.map(async (prospectId) => [
    prospectId,
    await resolveProspectBinding({ prospectId, siteSlug, select }),
  ])));
  const bound = [...unique.values()].filter((row) => Boolean(bindings.get(eventProspectId(row))));
  if (bound.length > ITEM_LIMIT) throw fail(503, "customer_source_incomplete", "call verification was incomplete");
  const checked = await boundedMap(bound, 4, async (row) => {
    const callId = eventCallId(row);
    let call;
    try {
      call = await vapiCall(callId, fetchImpl, env);
    } catch (error) {
      if (error && error.statusCode === 404) return null;
      throw error;
    }
    const eventAt = Date.parse(row.created_at);
    if (!ownedProviderCall(call, callId, eventProspectId(row), eventAt, now, env)) return null;
    const described = describeCallEvent(row);
    const transcript = normalizeTranscript(providerTranscript(call));
    return {
      ...described,
      transcriptAvailable: Boolean(transcript.value),
      recordingAvailable: explicitRecordingConsent(call) && Boolean(safeRecordingUrl(providerRecordingReference(call))),
    };
  });
  const own = checked.filter(Boolean);
  const answerStates = own.map((item) => Object.prototype.hasOwnProperty.call(item, "answered") ? item.answered : null);
  const answerCoverageComplete = answerStates.every((value) => value !== null);
  return {
    complete: true,
    rangeDays: RETENTION_DAYS,
    ...(answerCoverageComplete ? { answered: answerStates.filter(Boolean).length } : {}),
    answerCoverage: answerCoverageComplete ? "complete" : "incomplete",
    coverageLabel: "Only calls safely matched to this account are shown.",
    emptyLabel: "No calls can be safely matched to this account yet.",
    items: own,
  };
}

async function findOwnedCallEvent({ callId, siteSlug, select, now = Date.now() }) {
  if (!validCallId(callId)) throw fail(404, "call_not_found", "Call not found");
  const cutoff = now - RETENTION_MS;
  const response = await select(
    "ghost_agency_events",
    `select=id,type,payload,created_at&type=eq.${CALL_EVENT}&payload->>call_id=eq.${encodeURIComponent(callId)}&created_at=gte.${encodeURIComponent(new Date(cutoff).toISOString())}&order=created_at.desc&limit=21`,
  );
  const rows = readRows(response, "call history");
  if (rows.length >= 21) throw fail(503, "customer_source_incomplete", "call history was incomplete");
  const exact = rows.filter((row) => isRileyEvent(row, cutoff, now) && eventCallId(row) === callId);
  if (!exact.length) throw fail(404, "call_not_found", "Call not found");

  const prospectIds = [...new Set(exact.map(eventProspectId))];
  if (prospectIds.length !== 1) throw fail(404, "call_not_found", "Call not found");
  const binding = await resolveProspectBinding({ prospectId: prospectIds[0], siteSlug, select });
  if (!binding) throw fail(404, "call_not_found", "Call not found");
  return { row: exact[0], prospectId: prospectIds[0] };
}

function rileyAssistantId(env = process.env) {
  return String(
    env.VAPI_RILEY_ASSISTANT_ID ||
    env.VAPI_LOCAL_GROWTH_ASSISTANT_ID ||
    RILEY_ASSISTANT_FALLBACK,
  ).trim();
}

function timeoutGuard(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer), abort: () => controller.abort() };
}

function contentLength(headers) {
  const value = Number.parseInt(headers?.get?.("content-length") || "0", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

async function vapiCall(callId, fetchImpl = fetch, env = process.env) {
  const key = String(env.VAPI_API_KEY || "").trim();
  if (!key) throw fail(503, "call_details_unavailable", "Call details are unavailable");
  const guard = timeoutGuard(VAPI_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`https://api.vapi.ai/call/${encodeURIComponent(callId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      redirect: "error",
      signal: guard.signal,
    });
    if (response.status === 404) throw fail(404, "call_not_found", "Call not found");
    if (!response.ok) throw fail(503, "call_details_unavailable", "Call details are unavailable");
    if (contentLength(response.headers) > MAX_VAPI_JSON_BYTES) {
      throw fail(503, "call_details_unavailable", "Call details are unavailable");
    }
    const raw = typeof response.text === "function" ? await response.text() : JSON.stringify(await response.json());
    if (Buffer.byteLength(raw) > MAX_VAPI_JSON_BYTES) throw fail(503, "call_details_unavailable", "Call details are unavailable");
    const parsed = JSON.parse(raw);
    const call = parsed?.call && typeof parsed.call === "object" ? parsed.call : parsed;
    if (!call || typeof call !== "object" || Array.isArray(call)) throw new Error("invalid response");
    return call;
  } catch (error) {
    if (error && error.statusCode) throw error;
    throw fail(503, "call_details_unavailable", "Call details are unavailable");
  } finally {
    guard.done();
  }
}

function callAssistantId(call) {
  return String(call?.assistantId || call?.assistant_id || call?.assistant?.id || "").trim();
}

function callProspectId(call) {
  return String(call?.metadata?.prospect_id || call?.metadata?.prospectId || "").trim();
}

function cleanTranscriptPart(value) {
  if (value == null) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).trim();
  if (Array.isArray(value)) return value.map((part) => cleanTranscriptPart(part?.text ?? part?.message ?? part?.content ?? part)).filter(Boolean).join(" ");
  if (typeof value === "object") return cleanTranscriptPart(value.text ?? value.message ?? value.content ?? "");
  return "";
}

function transcriptString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (!entry || typeof entry !== "object") return "";
      const speaker = cleanTranscriptPart(entry.role || entry.speaker || entry.name || "Speaker").slice(0, 80) || "Speaker";
      const words = cleanTranscriptPart(entry.message ?? entry.text ?? entry.content);
      return words ? `${speaker}: ${words}` : "";
    }).filter(Boolean).join("\n");
  }
  if (typeof value === "object") return transcriptString(value.transcript ?? value.messages ?? value.text ?? value.content ?? "");
  return String(value).trim();
}

function normalizeTranscript(value) {
  const full = transcriptString(value);
  if (full.length <= MAX_TRANSCRIPT_CHARS) return { value: full, truncated: false };
  return { value: `${full.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[Transcript truncated for safety.]`, truncated: true };
}

function providerTranscript(call) {
  return call?.transcript ?? call?.artifact?.transcript ?? call?.artifact?.messages ?? call?.messages ?? null;
}

function explicitRecordingConsent(call) {
  const compliance = plainObject(call?.compliance) || {};
  const metadata = plainObject(call?.metadata) || {};
  return [
    call?.recordingConsentEnabled,
    call?.recording_consent_enabled,
    compliance.recordingConsent,
    compliance.recording_consent,
    metadata.recordingConsentEnabled,
    metadata.recording_consent_enabled,
  ].some((value) => value === true);
}

function providerRecordingReference(call) {
  const artifact = plainObject(call?.artifact) || {};
  const recording = artifact.recording;
  const values = [
    typeof recording === "string" ? recording : recording?.url,
    recording?.mono?.combinedUrl,
    recording?.stereoUrl,
    artifact.recordingUrl,
    call?.recordingUrl,
    call?.recording_url,
    typeof call?.recording === "string" ? call.recording : call?.recording?.url,
  ];
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function providerCallTime(call) {
  const value = call?.endedAt || call?.ended_at || call?.startedAt || call?.started_at || call?.createdAt || call?.created_at;
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
}

function ownedProviderCall(call, callId, prospectId, eventAt, now, env) {
  if (String(call?.id || "").trim() !== callId) return false;
  if (callAssistantId(call) !== rileyAssistantId(env)) return false;
  if (callProspectId(call) !== prospectId) return false;
  const providerAt = providerCallTime(call);
  if (providerAt != null && (providerAt < now - RETENTION_MS || providerAt > now + 5 * 60_000)) return false;
  return eventAt >= now - RETENTION_MS && eventAt <= now + 5 * 60_000;
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) || parts[0] >= 224;
}

function safeRecordingUrl(value) {
  if (!value) return null;
  let parsed;
  try { parsed = new URL(String(value)); } catch { return null; }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) return null;
  if (!hostname || (!hostname.includes(".") && !isIP(hostname)) || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) return null;
  if (isPrivateIpv4(hostname) || isIP(hostname) === 6) return null;
  return parsed;
}

function normalizeRange(value) {
  const range = String(value || "").trim();
  return /^bytes=(?:\d+-\d*|-\d+)$/.test(range) && range.length <= 80 ? range : "";
}

function audioContentType(value) {
  const type = String(value || "").split(";")[0].trim().toLowerCase();
  if (/^audio\/[a-z0-9.+-]+$/.test(type)) return type;
  if (["application/octet-stream", "binary/octet-stream", "application/ogg", "video/webm"].includes(type)) return type;
  return "";
}

async function fetchRecording(startUrl, range, fetchImpl = fetch) {
  const guard = timeoutGuard(AUDIO_TIMEOUT_MS);
  let current = safeRecordingUrl(startUrl);
  try {
    for (let redirects = 0; redirects <= 2; redirects += 1) {
      if (!current) throw fail(404, "recording_not_available", "Recording is not available");
      const headers = { Accept: "audio/*, application/octet-stream;q=0.8" };
      if (range) headers.Range = range;
      const response = await fetchImpl(current, { method: "GET", headers, redirect: "manual", signal: guard.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers?.get?.("location");
        current = location ? safeRecordingUrl(new URL(location, current).toString()) : null;
        continue;
      }
      return { response, guard };
    }
    throw fail(503, "recording_unavailable", "Recording is unavailable");
  } catch (error) {
    guard.done();
    if (error && error.statusCode) throw error;
    throw fail(503, "recording_unavailable", "Recording is unavailable");
  }
}

async function freshMonoRecording(callId, range, fetchImpl = fetch, env = process.env) {
  const key = String(env.VAPI_API_KEY || "").trim();
  if (!key) throw fail(503, "recording_unavailable", "Recording is unavailable");
  const artifactUrl = `https://api.vapi.ai/call/${encodeURIComponent(callId)}/mono-recording`;
  const guard = timeoutGuard(VAPI_TIMEOUT_MS);
  try {
    const response = await fetchImpl(artifactUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "audio/*, application/octet-stream;q=0.8" },
      redirect: "manual",
      signal: guard.signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.("location");
      let signed = null;
      try { signed = location ? safeRecordingUrl(new URL(location, artifactUrl).toString()) : null; } catch { signed = null; }
      guard.done();
      if (!signed) throw fail(503, "recording_unavailable", "Recording is unavailable");
      return fetchRecording(signed, range, fetchImpl);
    }
    if (![200, 206].includes(response.status)) throw fail(response.status === 404 || response.status === 410 ? 404 : 503, "recording_unavailable", "Recording is unavailable");
    return { response, guard };
  } catch (error) {
    guard.done();
    if (error && error.statusCode) throw error;
    throw fail(503, "recording_unavailable", "Recording is unavailable");
  }
}

function setAudioHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Vary", "x-connect-token, range");
}

async function proxyCustomerAudio({ req, res, callId, fetchImpl = fetch, env = process.env }) {
  const range = normalizeRange(req.headers?.range);
  const { response, guard } = await freshMonoRecording(callId, range, fetchImpl, env);
  try {
    if (![200, 206].includes(response.status)) throw fail(503, "recording_unavailable", "Recording is unavailable");
    const type = audioContentType(response.headers?.get?.("content-type"));
    if (!type) throw fail(503, "recording_unavailable", "Recording is unavailable");
    const declared = contentLength(response.headers);
    if (declared > MAX_AUDIO_BYTES) throw fail(413, "recording_too_large", "Recording is too large to play here");
    let buffered = null;
    if (!declared || !response.body || typeof res.write !== "function") {
      buffered = Buffer.from(await response.arrayBuffer());
      if (buffered.length > MAX_AUDIO_BYTES) throw fail(413, "recording_too_large", "Recording is too large to play here");
    }
    setAudioHeaders(res);
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Disposition", "inline");
    const contentRange = response.headers?.get?.("content-range") || "";
    if (response.status === 206 && /^bytes \d+-\d+\/\d+$/.test(contentRange)) res.setHeader("Content-Range", contentRange);
    if (response.status === 206 || /bytes/i.test(response.headers?.get?.("accept-ranges") || "")) res.setHeader("Accept-Ranges", "bytes");
    if (buffered) res.setHeader("Content-Length", String(buffered.length));
    else if (declared && !response.headers?.get?.("content-encoding")) res.setHeader("Content-Length", String(declared));
    res.statusCode = response.status;
    if (buffered) return res.end(buffered);
    let sent = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      sent += bytes.length;
      if (sent > MAX_AUDIO_BYTES) {
        guard.abort();
        if (typeof res.destroy === "function") res.destroy();
        return;
      }
      if (!res.write(bytes) && typeof res.once === "function") await once(res, "drain");
    }
    return res.end();
  } finally {
    guard.done();
  }
}

async function loadCustomerCallArtifact({ callId, siteSlug, select, now = Date.now(), fetchImpl = fetch, env = process.env }) {
  const owned = await findOwnedCallEvent({ callId, siteSlug, select, now });
  const call = await vapiCall(callId, fetchImpl, env);
  const eventAt = Date.parse(owned.row.created_at);
  if (!ownedProviderCall(call, callId, owned.prospectId, eventAt, now, env)) {
    throw fail(404, "call_not_found", "Call not found");
  }
  const transcript = normalizeTranscript(providerTranscript(call));
  const consent = explicitRecordingConsent(call);
  const recordingAvailable = consent && Boolean(safeRecordingUrl(providerRecordingReference(call)));
  const described = describeCallEvent(owned.row);
  return {
    providerCall: call,
    response: {
      ok: true,
      callId,
      at: described.at,
      outcome: described.outcome,
      summary: described.summary,
      transcript: transcript.value || null,
      transcriptAvailable: Boolean(transcript.value),
      transcriptTruncated: transcript.truncated,
      recordingAvailable,
      recordingReason: recordingAvailable ? "available" : (consent ? "recording_not_available" : "recording_consent_not_recorded"),
      audioPath: recordingAvailable ? `/api/connect/site?callId=${encodeURIComponent(callId)}&audio=1` : null,
      retentionExpiresAt: new Date(eventAt + RETENTION_MS).toISOString(),
    },
  };
}

module.exports = {
  CALL_EVENT,
  RETENTION_DAYS,
  RILEY_EVENT_ACTOR,
  audioContentType,
  canonicalProspectSlug,
  cleanText,
  answeredEvidence,
  describeCallEvent,
  explicitRecordingConsent,
  findOwnedCallEvent,
  loadCustomerCallArtifact,
  loadTenantCalls,
  normalizeRange,
  normalizeTranscript,
  proxyCustomerAudio,
  resolveProspectBinding,
  rileyAssistantId,
  safeRecordingUrl,
  validCallId,
};
