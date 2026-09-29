import { createHash, randomBytes } from "node:crypto";
import { validateBuildComplete } from "../../factory/lib/build-response-validator.mjs";

const PLAN_TIERS = new Set(["free-preview", "dfy-build", "dfy-build-pro", "agency"]);
const MODES = new Set(["single-page-cinematic", "premier-multi-page"]);
const TOP_LEVEL_KEYS = new Set(["schema_version", "idempotency_key", "requested_at", "caller", "plan_tier", "mode", "truth_packet", "assets", "resonance_hint", "design_constraints", "callback"]);
const TRUTH_KEYS = new Set(["business_name", "legal_name", "city", "state", "postal_code", "street_address", "phone_e164", "email", "website_url", "google_place_id", "gbp_url", "facebook_url", "instagram_url", "vertical", "one_line_description", "services", "license_credentials", "established_year", "hours", "service_area_cities"]);
const ASSET_KEYS = new Set(["logo_url", "photo_urls", "hero_video_url", "reviews", "gbp_photos_place_id"]);
const CALLER_KEYS = new Set(["source", "operator_id", "trace_id"]);
const CALLER_SOURCES = new Set(["siteforge-app", "ghost-agency", "answercrew", "operator-console", "api-partner"]);
const DESIGN_KEYS = new Set(["force_archetype", "force_widget", "force_palette_family", "banned_archetypes", "widget_hint"]);
const CALLBACK_KEYS = new Set(["webhook_url", "webhook_secret_env"]);
const TERMINAL_STATES = new Set(["ready", "failed", "cancelled"]);

export class ContractBuildError extends Error {
  constructor(message, { status = 400, code = "INVALID_BUILD_REQUEST", details } = {}) {
    super(message);
    this.name = "ContractBuildError";
    this.status = status;
    this.code = code;
    if (details?.length) this.details = details;
  }
}

export function validateBuildRequest(value, { now = () => new Date() } = {}) {
  const problems = [];
  if (!isObject(value)) throw invalid(["request body must be an object"]);
  rejectExtra(value, TOP_LEVEL_KEYS, "request", problems);
  if (value.schema_version !== "siteforge-build-request-v1") problems.push("schema_version must be siteforge-build-request-v1");
  if (typeof value.idempotency_key !== "string" || value.idempotency_key.length < 16 || value.idempotency_key.length > 128) problems.push("idempotency_key must be 16-128 characters");
  if (typeof value.idempotency_key === "string" && !/^[A-Za-z0-9._:-]+$/.test(value.idempotency_key)) problems.push("idempotency_key contains invalid characters");
  if (!PLAN_TIERS.has(value.plan_tier)) problems.push("plan_tier is invalid");
  if (value.mode != null && !MODES.has(value.mode)) problems.push("mode is invalid");
  validateRequestedAt(value.requested_at, now(), problems);
  validateTruthPacket(value.truth_packet, problems);
  validateAssets(value.assets, problems);
  validateCaller(value.caller, problems);
  validateResonance(value.resonance_hint, problems);
  validateDesign(value.design_constraints, problems);
  validateCallback(value.callback, problems);
  if (problems.length) throw invalid(problems);
  return structuredClone({ ...value, mode: value.mode || "single-page-cinematic" });
}

export function idempotencyPayloadHash(request) {
  return createHash("sha256").update(canonicalJson({
    truth_packet: request.truth_packet,
    resonance_hint: request.resonance_hint ?? null,
  })).digest("hex");
}

export function createContractBuildService({ store, startBuild, now = () => new Date(), idFactory = ulid } = {}) {
  if (!store || typeof store.claim !== "function" || typeof store.get !== "function" || typeof store.saveTerminal !== "function") throw new TypeError("Contract build store is required");
  if (typeof startBuild !== "function") throw new TypeError("startBuild is required");

  return {
    async submit(rawRequest, { ownerId = "anonymous" } = {}) {
      const request = validateBuildRequest(rawRequest, { now });
      const payloadHash = idempotencyPayloadHash(request);
      const buildId = idFactory();
      const acceptedAt = now().toISOString();
      const queued = queuedStatus(buildId, request.idempotency_key, acceptedAt, request.caller?.trace_id);
      const envelope = { version: 1, build_id: buildId, owner_id: ownerId, accepted_at: acceptedAt, response: queued };
      store.assertAvailable?.();
      const claim = await store.claim({
        ownerId,
        idempotencyKey: request.idempotency_key,
        payloadHash,
        buildId,
        acceptedAt,
        envelope,
      });

      if (!claim.owner) {
        if (claim.lease.payload_hash !== payloadHash) {
          throw new ContractBuildError("Idempotency key was already used for a different payload", {
            status: 409,
            code: "IDEMPOTENCY_KEY_COLLISION_DIFFERENT_PAYLOAD",
          });
        }
        const existing = claim.envelope?.response || queuedStatus(claim.lease.build_id, request.idempotency_key, claim.lease.accepted_at, request.caller?.trace_id);
        return { statusCode: isTerminal(existing) ? 200 : 202, replay: true, response: existing };
      }

      try {
        const complete = hardenCompleteResponse(await startBuild(request, { buildId, now }), { buildId, idempotencyKey: request.idempotency_key });
        const saved = await store.saveTerminal(buildId, complete);
        return { statusCode: 202, replay: false, response: saved.response };
      } catch (cause) {
        const failure = failedBuild(buildId, request.idempotency_key, now().toISOString(), safeFailureCode(cause), request.caller?.trace_id);
        await store.saveTerminal(buildId, failure);
        if (cause instanceof ContractBuildError) throw cause;
        throw new ContractBuildError("Build could not be completed", {
          status: Number(cause?.status) >= 400 ? Number(cause.status) : 503,
          code: safeFailureCode(cause),
        });
      }
    },
    async get(buildId, { ownerId = "anonymous" } = {}) {
      if (typeof buildId !== "string" || !/^[A-Za-z0-9_-]{10,128}$/.test(buildId)) throw notFound();
      const envelope = await store.get(buildId);
      if (!envelope || envelope.owner_id !== ownerId) throw notFound();
      return envelope.response;
    },
  };
}

function hardenCompleteResponse(value, { buildId, idempotencyKey }) {
  if (!isObject(value) || value.status !== "ready") throw new ContractBuildError("Engine returned an invalid terminal response", { status: 503, code: "BUILD_RESPONSE_CONTRACT_VIOLATION" });
  if (value.build_id !== buildId || value.idempotency_key !== idempotencyKey) throw new ContractBuildError("Engine returned mismatched build identity", { status: 503, code: "BUILD_RESPONSE_CONTRACT_VIOLATION" });
  const urlsValid = isArtifactUrl(value.preview_url, "index.html") && isArtifactUrl(value.report_url, "optimization-manifest.json");
  const complete = { ...value, qc_passed: value.qc_passed === true && value.visual_qc_passed === true && urlsValid };
  validateBuildComplete(complete);
  return complete;
}

function validateRequestedAt(value, current, problems) {
  if (value == null) return;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
    problems.push("requested_at must be an ISO-8601 UTC timestamp");
    return;
  }
  const requested = Date.parse(value);
  const age = current.getTime() - requested;
  if (!Number.isFinite(requested)) problems.push("requested_at is invalid");
  else if (age > 5 * 60 * 1000) problems.push("requested_at is stale");
  else if (age < -60 * 1000) problems.push("requested_at is too far in the future");
}

function validateTruthPacket(value, problems) {
  if (!isObject(value)) { problems.push("truth_packet must be an object"); return; }
  rejectExtra(value, TRUTH_KEYS, "truth_packet", problems);
  for (const key of ["business_name", "city", "state", "vertical"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) problems.push(`truth_packet.${key} is required`);
  }
  if (typeof value.business_name === "string" && value.business_name.trim().length < 2) problems.push("truth_packet.business_name is too short");
  if (typeof value.state === "string" && !/^[A-Z]{2}$/.test(value.state)) problems.push("truth_packet.state must be a two-letter uppercase code");
  if (value.phone_e164 != null && !/^\+[1-9][0-9]{7,14}$/.test(value.phone_e164)) problems.push("truth_packet.phone_e164 is invalid");
  if (value.email != null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) problems.push("truth_packet.email is invalid");
  for (const key of ["website_url", "gbp_url", "facebook_url", "instagram_url"]) if (value[key] != null && !isHttpUrl(value[key])) problems.push(`truth_packet.${key} must be an http(s) URL`);
  for (const [key, max] of [["services", 24], ["service_area_cities", 32]]) {
    if (value[key] != null && (!Array.isArray(value[key]) || value[key].length > max || value[key].some((item) => typeof item !== "string"))) problems.push(`truth_packet.${key} is invalid`);
  }
  if (value.established_year != null && (!Number.isInteger(value.established_year) || value.established_year < 1800 || value.established_year > 2100)) problems.push("truth_packet.established_year is invalid");
  if (value.license_credentials != null && !Array.isArray(value.license_credentials)) problems.push("truth_packet.license_credentials must be an array");
  if (value.hours != null && !Array.isArray(value.hours)) problems.push("truth_packet.hours must be an array");
}

function validateAssets(value, problems) {
  if (value == null) return;
  if (!isObject(value)) { problems.push("assets must be an object"); return; }
  rejectExtra(value, ASSET_KEYS, "assets", problems);
  for (const key of ["logo_url", "hero_video_url"]) if (value[key] != null && !isHttpUrl(value[key])) problems.push(`assets.${key} must be an http(s) URL`);
  if (value.photo_urls != null && (!Array.isArray(value.photo_urls) || value.photo_urls.length > 24 || value.photo_urls.some((url) => !isHttpUrl(url)))) problems.push("assets.photo_urls is invalid");
  if (value.reviews != null && (!Array.isArray(value.reviews) || value.reviews.length > 50 || value.reviews.some((review) => !isObject(review)))) problems.push("assets.reviews is invalid");
}

function validateCaller(value, problems) {
  if (value == null) return;
  if (!isObject(value)) { problems.push("caller must be an object"); return; }
  rejectExtra(value, CALLER_KEYS, "caller", problems);
  if (!CALLER_SOURCES.has(value.source)) problems.push("caller.source is invalid");
}

function validateResonance(value, problems) {
  if (value == null) return;
  if (!isObject(value)) { problems.push("resonance_hint must be an object"); return; }
  for (const key of ["vocabulary_triggers", "banned_words", "mirror_words"]) {
    if (value[key] != null && (!Array.isArray(value[key]) || value[key].some((item) => typeof item !== "string"))) problems.push(`resonance_hint.${key} is invalid`);
  }
}

function validateDesign(value, problems) {
  if (value == null) return;
  if (!isObject(value)) { problems.push("design_constraints must be an object"); return; }
  rejectExtra(value, DESIGN_KEYS, "design_constraints", problems);
  if (value.banned_archetypes != null && (!Array.isArray(value.banned_archetypes) || value.banned_archetypes.some((item) => typeof item !== "string"))) problems.push("design_constraints.banned_archetypes is invalid");
}

function validateCallback(value, problems) {
  if (value == null) return;
  if (!isObject(value)) { problems.push("callback must be an object"); return; }
  rejectExtra(value, CALLBACK_KEYS, "callback", problems);
  if (value.webhook_url != null && !isHttpUrl(value.webhook_url)) problems.push("callback.webhook_url must be an http(s) URL");
}

function queuedStatus(buildId, idempotencyKey, emittedAt, traceId) {
  return compact({
    schema_version: "siteforge-build-status-v1",
    build_id: buildId,
    idempotency_key: idempotencyKey,
    state: "queued",
    progress: { percent: 0, step: 0, step_of: 1, step_label: "Accepted" },
    emitted_at: emittedAt,
    trace_id: traceId,
  });
}

function failedBuild(buildId, idempotencyKey, failedAt, code, traceId) {
  return compact({
    schema_version: "siteforge-build-failure-v1",
    build_id: buildId,
    idempotency_key: idempotencyKey,
    failed_at: failedAt,
    failure_stage: failureStage(code),
    error_code: code,
    operator_message: "Build could not be completed.",
    trace_id: traceId,
    retry_policy: {
      retriable: false,
      recommended_backoff_seconds: 0,
      max_retries_reached: true,
      action_required: "operator-review",
    },
  });
}

function failureStage(code) {
  if (/ARTIFACT|BLOB/.test(code)) return "publish-preview";
  if (/CONTRACT|TRUTH|REQUEST/.test(code)) return "intake-validation";
  if (/QC|AUTHORITY|CONTAMINATION/.test(code)) return "qc-authority-108";
  if (/CAPTURE|CHROMIUM/.test(code)) return "capture-desktop";
  return "render-html";
}

function ulid() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let time = Date.now();
  let head = "";
  for (let i = 0; i < 10; i += 1) { head = alphabet[time % 32] + head; time = Math.floor(time / 32); }
  const bytes = randomBytes(16);
  let tail = "";
  for (let i = 0; i < 16; i += 1) tail += alphabet[bytes[i] & 31];
  return head + tail;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function rejectExtra(value, allowed, label, problems) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) problems.push(`${label}.${key} is not allowed`);
}

function invalid(details) {
  return new ContractBuildError("Build request failed validation", { details });
}

function notFound() {
  return new ContractBuildError("Build not found", { status: 404, code: "BUILD_NOT_FOUND" });
}

function safeFailureCode(error) {
  return /^[A-Z][A-Z0-9_]{2,80}$/.test(String(error?.code || "")) ? error.code : "BUILD_FAILED";
}

function isTerminal(response) {
  return TERMINAL_STATES.has(response?.status || response?.state)
    || response?.schema_version === "siteforge-build-failure-v1";
}

function isHttpUrl(value) {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function isArtifactUrl(value, filename) {
  if (!isHttpUrl(value)) return false;
  try { return new URL(value).pathname.endsWith(`/${filename}`); } catch { return false; }
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
