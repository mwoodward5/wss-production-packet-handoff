"use strict";

const { once } = require("node:events");
const { isIP } = require("node:net");
const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { select } = require("../../lib/store");

const RILEY_ASSISTANT_FALLBACK = "5b5e73a3-2bd7-4777-8233-077bf7ffddc6";
const RETENTION_MS = 14 * 86400000;
const VAPI_TIMEOUT_MS = 8_000;
const AUDIO_TIMEOUT_MS = 30_000;
const MAX_VAPI_JSON_BYTES = 5 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 500_000;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Vary", "x-admin-token, authorization, range");
}

function firstQueryValue(value) {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : "";
  return value == null ? "" : String(value);
}

function requestQuery(req) {
  let parsed;
  try {
    parsed = new URL(req.url || "/", "https://ghost.wss-ai.com");
  } catch {
    parsed = new URL("https://ghost.wss-ai.com/");
  }
  const callId = firstQueryValue(req.query?.callId || parsed.searchParams.get("callId")).trim();
  const audio = firstQueryValue(req.query?.audio || parsed.searchParams.get("audio")).trim();
  return { callId, audio: audio === "1" };
}

function validCallId(value) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(String(value || ""));
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

function cleanTranscriptPart(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map((part) => cleanTranscriptPart(part?.text ?? part?.message ?? part?.content ?? part)).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    return cleanTranscriptPart(value.text ?? value.message ?? value.content ?? "");
  }
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
  if (typeof value === "object") {
    return transcriptString(value.transcript ?? value.messages ?? value.text ?? value.content ?? "");
  }
  return String(value).trim();
}

function normalizeTranscript(value) {
  const full = transcriptString(value);
  if (full.length <= MAX_TRANSCRIPT_CHARS) return { value: full, truncated: false };
  return {
    value: `${full.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[Transcript truncated for safety.]`,
    truncated: true,
  };
}

function payloadObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function validIso(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function computedRetentionExpiry(call = {}) {
  const source = call.endedAt || call.ended_at || call.startedAt || call.started_at || call.createdAt || call.created_at;
  const time = Date.parse(source || "");
  return Number.isFinite(time) ? new Date(time + RETENTION_MS).toISOString() : null;
}

function storedRetention(row, now = Date.now()) {
  const payload = payloadObject(row?.payload);
  const expiresAt = validIso(row?.artifact_retention_expires_at || payload.artifact_retention_expires_at);
  const purgedAt = validIso(payload.retention_purged_at);
  return {
    expiresAt,
    expired: Boolean(purgedAt || (expiresAt && Date.parse(expiresAt) <= now)),
    purgedAt,
  };
}

async function storedArtifacts(callId) {
  try {
    const query = "?select=vapi_call_id,transcript,recording_url,artifact_retention_expires_at,payload" +
      `&vapi_call_id=eq.${encodeURIComponent(callId)}&limit=1`;
    const response = await select("mission_control_customer_calls", query);
    return response.ok && Array.isArray(response.data) ? response.data[0] || null : null;
  } catch {
    // The operator can still read the provider's retained copy when this
    // optional customer-artifact table is unavailable. Its tombstone wins
    // whenever it is present; an unavailable table never invents expiry.
    return null;
  }
}

async function vapiCall(callId, fetchImpl = fetch) {
  const key = String(process.env.VAPI_API_KEY || "").trim();
  if (!key) throw fail(503, "vapi_unconfigured", "Call artifacts are not configured");

  const guard = timeoutGuard(VAPI_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`https://api.vapi.ai/call/${encodeURIComponent(callId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      redirect: "error",
      signal: guard.signal,
    });
    if (response.status === 404) throw fail(404, "call_not_found", "Call not found");
    if (!response.ok) throw fail(502, "vapi_unavailable", "The voice provider did not answer");

    const declared = contentLength(response.headers);
    if (declared > MAX_VAPI_JSON_BYTES) throw fail(502, "vapi_response_too_large", "The voice provider response was too large");
    const raw = typeof response.text === "function"
      ? await response.text()
      : JSON.stringify(await response.json());
    if (Buffer.byteLength(raw) > MAX_VAPI_JSON_BYTES) throw fail(502, "vapi_response_too_large", "The voice provider response was too large");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw fail(502, "vapi_invalid_response", "The voice provider returned an unreadable response");
    }
    const call = parsed?.call && typeof parsed.call === "object" ? parsed.call : parsed;
    if (!call || typeof call !== "object" || Array.isArray(call)) {
      throw fail(502, "vapi_invalid_response", "The voice provider returned an unreadable response");
    }
    return call;
  } catch (error) {
    if (error?.statusCode) throw error;
    throw fail(502, "vapi_unavailable", "The voice provider did not answer");
  } finally {
    guard.done();
  }
}

function callAssistantId(call = {}) {
  return String(call.assistantId || call.assistant_id || call.assistant?.id || "").trim();
}

function providerTranscript(call = {}) {
  return call.transcript ?? call.artifact?.transcript ?? call.artifact?.messages ?? call.messages ?? null;
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    parts[0] >= 224;
}

function safeRecordingUrl(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) return null;
  if (!hostname || (!hostname.includes(".") && !isIP(hostname)) || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) return null;
  if (isPrivateIpv4(hostname) || isIP(hostname) === 6) return null;
  return parsed;
}

function providerRecordingReference(call = {}) {
  const artifact = call.artifact && typeof call.artifact === "object" ? call.artifact : {};
  const recording = artifact.recording;
  const candidates = [
    typeof recording === "string" ? recording : recording?.url,
    recording?.mono?.combinedUrl,
    recording?.stereoUrl,
    artifact.recordingUrl,
    call.recordingUrl,
    call.recording_url,
    typeof call.recording === "string" ? call.recording : call.recording?.url,
    call.recording?.mono?.combinedUrl,
    call.recording?.stereoUrl,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

function artifactState(call, stored, now = Date.now()) {
  const localRetention = storedRetention(stored, now);
  const providerRecordingPresent = Boolean(providerRecordingReference(call));
  const storedRecordingPresent = Boolean(String(stored?.recording_url || "").trim());
  const providerText = normalizeTranscript(providerTranscript(call));
  const storedText = normalizeTranscript(stored?.transcript);
  const retentionExpiresAt = localRetention.expiresAt || computedRetentionExpiry(call);
  const computedExpired = Boolean(
    !localRetention.expiresAt &&
    retentionExpiresAt &&
    Date.parse(retentionExpiresAt) <= now &&
    (providerRecordingPresent || providerText.value),
  );
  const expired = localRetention.expired || computedExpired;
  const recordingAvailable = !expired && (providerRecordingPresent || storedRecordingPresent);
  const transcript = expired ? { value: "", truncated: false } : (storedText.value ? storedText : providerText);
  return {
    callId: String(call.id || stored?.vapi_call_id || ""),
    transcript: transcript.value || null,
    transcriptTruncated: transcript.truncated,
    recordingAvailable,
    recordingExpired: expired,
    retentionExpiresAt,
  };
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
      const response = await fetchImpl(current, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: guard.signal,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers?.get?.("location");
        current = location ? safeRecordingUrl(new URL(location, current).toString()) : null;
        continue;
      }
      return { response, guard };
    }
    throw fail(502, "recording_redirect_refused", "The recording provider redirected too many times");
  } catch (error) {
    guard.done();
    if (error?.statusCode) throw error;
    throw fail(502, "recording_unavailable", "The recording provider did not answer");
  }
}

async function freshMonoRecording(callId, range, fetchImpl = fetch) {
  const key = String(process.env.VAPI_API_KEY || "").trim();
  if (!key) throw fail(503, "vapi_unconfigured", "Call artifacts are not configured");

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
      let signedUrl = null;
      try {
        signedUrl = location ? safeRecordingUrl(new URL(location, artifactUrl).toString()) : null;
      } catch {
        signedUrl = null;
      }
      guard.done();
      if (!signedUrl) throw fail(502, "recording_redirect_refused", "The recording provider returned an unsafe redirect");
      // VAPI's key authenticates only the artifact request above. The redirect
      // target is a short-lived signed URL and must never receive that key.
      return fetchRecording(signedUrl, range, fetchImpl);
    }
    if (response.status === 404 || response.status === 410) {
      throw fail(404, "recording_not_available", "Recording is not available");
    }
    if (response.status !== 200 && response.status !== 206) {
      throw fail(502, "recording_unavailable", "The voice provider did not return a recording");
    }
    return { response, guard };
  } catch (error) {
    guard.done();
    if (error?.statusCode) throw error;
    throw fail(502, "recording_unavailable", "The voice provider did not answer");
  }
}

async function proxyAudio(req, res, callId) {
  const range = normalizeRange(req.headers?.range);
  const { response, guard } = await freshMonoRecording(callId, range);
  try {
    if (response.status === 416) throw fail(416, "recording_range_not_satisfiable", "The requested audio range is not available");
    if (response.status === 404) throw fail(404, "recording_not_available", "Recording is not available");
    if (response.status !== 200 && response.status !== 206) throw fail(502, "recording_unavailable", "The recording provider did not return audio");

    const type = audioContentType(response.headers?.get?.("content-type"));
    if (!type) throw fail(502, "recording_invalid_type", "The recording provider did not return audio");
    const declared = contentLength(response.headers);
    if (declared > MAX_AUDIO_BYTES) throw fail(413, "recording_too_large", "Recording is too large to play here");

    let buffered = null;
    if (!declared || !response.body || typeof res.write !== "function") {
      buffered = Buffer.from(await response.arrayBuffer());
      if (buffered.length > MAX_AUDIO_BYTES) throw fail(413, "recording_too_large", "Recording is too large to play here");
    }

    setSecurityHeaders(res);
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Disposition", "inline");
    const contentRange = response.headers?.get?.("content-range") || "";
    if (response.status === 206 && /^bytes \d+-\d+\/\d+$/.test(contentRange)) res.setHeader("Content-Range", contentRange);
    if (response.status === 206 || /bytes/i.test(response.headers?.get?.("accept-ranges") || "")) res.setHeader("Accept-Ranges", "bytes");
    if (buffered) res.setHeader("Content-Length", String(buffered.length));
    else if (declared && !response.headers?.get?.("content-encoding")) res.setHeader("Content-Length", String(declared));
    res.statusCode = response.status;

    if (buffered) {
      res.end(buffered);
      return;
    }

    let sent = 0;
    try {
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
      res.end();
    } catch (error) {
      if (typeof res.destroy === "function") res.destroy(error);
      else throw error;
    }
  } finally {
    guard.done();
  }
}

async function handler(req, res) {
  setSecurityHeaders(res);
  if (!methodGuard(req, res, ["GET"])) return;
  if (!requireAdmin(req, res)) return;

  try {
    const query = requestQuery(req);
    if (!query.callId) throw fail(400, "call_id_required", "callId is required");
    if (!validCallId(query.callId)) throw fail(400, "invalid_call_id", "callId is invalid");

    // Read the local retention marker before consulting VAPI. The provider may
    // still hold a signed URL after WSS's fixed window; that never resurrects
    // an artifact which our retention job already purged.
    const stored = await storedArtifacts(query.callId);
    const call = await vapiCall(query.callId);
    const returnedCallId = String(call.id || "").trim();
    if ((returnedCallId && returnedCallId !== query.callId) || callAssistantId(call) !== rileyAssistantId()) {
      throw fail(404, "call_not_found", "Call not found");
    }
    const state = artifactState(call, stored);

    if (query.audio) {
      if (state.recordingExpired) throw fail(410, "recording_expired", "Recording expired after the 14-day retention window");
      if (!state.recordingAvailable) throw fail(404, "recording_not_available", "Recording is not available");
      await proxyAudio(req, res, query.callId);
      return;
    }

    const recordingReason = state.recordingExpired
      ? "recording_expired"
      : state.recordingAvailable
        ? "available"
        : "recording_not_available";
    sendJson(res, 200, {
      ok: true,
      callId: query.callId,
      transcript: state.transcript,
      transcriptAvailable: Boolean(state.transcript),
      transcriptTruncated: state.transcriptTruncated,
      recordingAvailable: state.recordingAvailable,
      recordingExpired: state.recordingExpired,
      recordingReason,
      audioUrl: state.recordingAvailable
        ? `/api/admin/call-artifact?callId=${encodeURIComponent(query.callId)}&audio=1`
        : null,
      retentionExpiresAt: state.retentionExpiresAt,
    });
  } catch (error) {
    if (res.headersSent) {
      if (typeof res.destroy === "function") res.destroy(error);
      return;
    }
    handleError(res, error);
  }
}

module.exports = handler;
module.exports.artifactState = artifactState;
module.exports.audioContentType = audioContentType;
module.exports.normalizeRange = normalizeRange;
module.exports.normalizeTranscript = normalizeTranscript;
module.exports.rileyAssistantId = rileyAssistantId;
module.exports.safeRecordingUrl = safeRecordingUrl;
module.exports.storedRetention = storedRetention;
module.exports.validCallId = validCallId;
