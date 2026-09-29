"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const POLICY_VERSION = "wan-local-hero-v1";
const PROMPT_PACK_ARCHIVE_SHA256 = "51cfa0c491ef7acf268a729e2b8a9e513731cc9ac1a13bc46450e328fe0f9248";
const WAN_MODEL_ID = "Wan-AI/Wan2.1-I2V-14B-480P-Diffusers";
const WAN_MODEL_REVISION = "b184e23a8a16b20f108f727c902e769e873ffc73";
const WAN_DEFAULT_SETTINGS = Object.freeze({
  fps: 16,
  guidanceScale: 5,
  numInferenceSteps: 30,
  quantization: "bitsandbytes_nf4_4bit_double_quant_bf16",
  width: 832,
  height: 480,
});
const WAN_REMASTER_RECIPE = [
  "wss-wan-source-prep-v1",
  "scale=min(iw,1920):h=-2:lanczos:no-upscale",
  "hqdn3d=0.8:0.8:1.5:1.5",
  "unsharp=5:5:0.25:5:5:0",
  "eq=contrast=1.01:saturation=1.02:gamma=1",
  "jpeg-q2:yuvj420p:metadata-stripped:bitexact",
].join("|");
const WAN_REMASTER_RECIPE_SHA256 = createHash("sha256").update(WAN_REMASTER_RECIPE).digest("hex");
const PACK_ROOT = path.join(__dirname, "..", "scripts", "wan-hero", "prompt-pack", POLICY_VERSION);
const VERTICALS = require("../scripts/wan-hero/prompt-pack/wan-local-hero-v1/config/verticals.json");
const PRESETS = require("../scripts/wan-hero/prompt-pack/wan-local-hero-v1/config/presets.json");
const PROMPT_TEMPLATE = fs.readFileSync(path.join(PACK_ROOT, "prompts", "prompt-template.txt"), "utf8").trim();
const NEGATIVE_PROMPT = fs.readFileSync(path.join(PACK_ROOT, "prompts", "negative-prompt.txt"), "utf8").trim();

const ALLOWED_VERTICALS = Object.freeze(Object.keys(VERTICALS));
const ALLOWED_SOURCE_TYPES = Object.freeze(["own_site", "gbp"]);
const ALLOWED_OVERLAY_SIDES = Object.freeze(["left", "right"]);
const PEOPLE_SENSITIVE_VERTICALS = Object.freeze(["med_spa", "hair_salon", "tattoo"]);

const SPORT_FENCING_SIGNAL_PATTERNS = Object.freeze([
  ["club", /\bclub\b/],
  ["sword", /\bswords?\b/],
  ["sabre", /\bsab(?:re|er)s?\b/],
  ["foil", /\bfoils?\b/],
  ["epee", /\bepees?\b/],
  ["olympic", /\bolympi(?:c|an)s?\b/],
  ["coach", /\bcoach(?:es|ing)?\b/],
  ["classes", /\bclasses\b/],
  ["training", /\btraining\b/],
  ["footwork", /\bfootwork\b/],
  ["blade", /\bblades?\b/],
  ["athletes", /\bathletes?\b/],
  ["sport", /\bsports?\b/],
]);

function failure(reason, detail = "") {
  return { ok: false, reason, ...(detail ? { detail: String(detail).slice(0, 200) } : {}) };
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizeToken(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeVertical(value) {
  return normalizeToken(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeProspectId(value) {
  const id = normalizeToken(value);
  if (!id || id.length > 160 || !/^[a-z0-9][a-z0-9._:-]*$/.test(id)) return "";
  return id;
}

function normalizeDomain(value) {
  const raw = normalizeToken(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return "";
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!hostname.includes(".") || hostname === "localhost" || !/^[a-z0-9.-]+$/.test(hostname)) return "";
    if (hostname.split(".").some((part) => !part || part.startsWith("-") || part.endsWith("-"))) return "";
    return hostname;
  } catch {
    return "";
  }
}

function normalizeSha256(value) {
  const sha = normalizeToken(value);
  return /^[a-f0-9]{64}$/.test(sha) ? sha : "";
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableSerialize(value, seen = new Set()) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("model_settings_not_json_safe");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("model_settings_circular");
    seen.add(value);
    const serialized = `[${value.map((entry) => stableSerialize(entry, seen)).join(",")}]`;
    seen.delete(value);
    return serialized;
  }
  if (plainObject(value)) {
    if (seen.has(value)) throw new TypeError("model_settings_circular");
    seen.add(value);
    const serialized = `{${Object.keys(value).sort().map((key) => {
      if (value[key] === undefined) throw new TypeError("model_settings_not_json_safe");
      return `${JSON.stringify(key)}:${stableSerialize(value[key], seen)}`;
    }).join(",")}}`;
    seen.delete(value);
    return serialized;
  }
  throw new TypeError("model_settings_not_json_safe");
}

function normalizeModelSettings(value) {
  if (!plainObject(value) || Object.keys(value).length === 0) return null;
  try {
    const serialized = stableSerialize(value);
    if (Buffer.byteLength(serialized, "utf8") > 16 * 1024) return null;
    return { value: JSON.parse(serialized), serialized };
  } catch {
    return null;
  }
}

function sportFencingSignals(input = {}) {
  const text = [input.businessName, input.gbpCategory, input.siteText]
    .map((value) => String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, " "))
    .join(" \n ");
  return SPORT_FENCING_SIGNAL_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([signal]) => signal);
}

function defaultWanGeneration(input = {}) {
  const prospectId = normalizeProspectId(input.prospectId);
  const vertical = normalizeVertical(input.vertical);
  const preset = normalizeToken(input.preset || "cheap_5s");
  if (!prospectId || !ALLOWED_VERTICALS.includes(vertical) || !PRESETS[preset]) return null;
  const durationSeconds = Number(PRESETS[preset].duration_seconds);
  const digest = createHash("sha256").update(`${POLICY_VERSION}:${prospectId}`).digest();
  const seed = digest.readUInt32BE(0) & 0x7fffffff;
  const overlaySide = input.overlaySide
    ? normalizeToken(input.overlaySide)
    : (digest[4] % 2 ? "right" : "left");
  if (!ALLOWED_OVERLAY_SIDES.includes(overlaySide)) return null;
  return {
    vertical,
    overlaySide,
    preset,
    durationSeconds,
    modelId: WAN_MODEL_ID,
    modelRevision: WAN_MODEL_REVISION,
    modelSettings: {
      ...WAN_DEFAULT_SETTINGS,
      seed,
      numFrames: durationSeconds * WAN_DEFAULT_SETTINGS.fps + 1,
    },
  };
}

function replaceAll(template, token, value) {
  return template.split(token).join(String(value));
}

function renderPrompt({ vertical, durationSeconds, camera, motion, overlaySide }) {
  let prompt = PROMPT_TEMPLATE;
  prompt = replaceAll(prompt, "{VERTICAL}", vertical.replace(/_/g, " "));
  prompt = replaceAll(prompt, "{DURATION}", durationSeconds);
  prompt = replaceAll(prompt, "{CAMERA}", camera);
  prompt = replaceAll(prompt, "{MOTION}", motion);
  const side = overlaySide.toUpperCase();
  prompt += `\n\nOVERLAY SPACE: Keep the ${side} 40% visually calm and uncluttered for website headline and CTA overlay.`;
  return prompt;
}

/**
 * Turn an identity-bound, real client photograph into a deterministic WAN
 * prompt contract. This module chooses no image and calls no provider.
 */
function buildWanHeroPolicy(input = {}) {
  const prospectId = normalizeProspectId(input.prospectId);
  if (!prospectId) return failure("prospect_id_required");

  const domain = normalizeDomain(input.domain);
  if (!domain) return failure("prospect_domain_required");

  const sourceSha256 = normalizeSha256(input.sourceSha256);
  if (!sourceSha256) return failure("source_sha256_required");

  const sourceType = normalizeToken(input.sourceType);
  if (!ALLOWED_SOURCE_TYPES.includes(sourceType)) return failure("source_type_not_allowed");

  const sourceAssetType = normalizeToken(input.sourceAssetType);
  if (sourceAssetType !== "real_scene") return failure("source_asset_not_real_scene");

  const vertical = normalizeVertical(input.vertical);
  if (!ALLOWED_VERTICALS.includes(vertical)) return failure("vertical_not_allowed");

  const overlaySide = normalizeToken(input.overlaySide);
  if (!ALLOWED_OVERLAY_SIDES.includes(overlaySide)) return failure("overlay_side_not_allowed");

  const presetName = normalizeToken(input.preset || "cheap_5s");
  const preset = PRESETS[presetName];
  if (!preset) return failure("preset_not_allowed");
  const durationSeconds = Number(preset.duration_seconds);
  if (input.durationSeconds != null && Number(input.durationSeconds) !== durationSeconds) {
    return failure("duration_preset_mismatch");
  }

  const peopleSensitive = PEOPLE_SENSITIVE_VERTICALS.includes(vertical);
  if (peopleSensitive && input.allowPeopleSensitive !== true) {
    return failure("people_sensitive_vertical_disabled");
  }
  if ((peopleSensitive || input.containsRecognizablePeople === true) && input.peopleConsentVerified !== true) {
    return failure("people_consent_required");
  }

  const fencingSignals = vertical === "fencing" ? sportFencingSignals(input) : [];
  const fencingClassification = normalizeToken(input.fencingClassification);
  if (vertical === "fencing" && (fencingClassification === "sport" || fencingSignals.length >= 2)) {
    return failure("vertical_mismatch_sport_fencing", fencingSignals.join(","));
  }
  if (vertical === "fencing" && fencingClassification !== "contracting") {
    return failure("fencing_contracting_required");
  }

  const modelId = String(input.modelId || "").trim();
  if (!modelId || modelId.length > 240) return failure("model_id_required");
  const modelRevision = String(input.modelRevision || "").trim();
  if (!modelRevision || modelRevision.length > 240) return failure("model_revision_required");
  const settings = normalizeModelSettings(input.modelSettings);
  if (!settings) return failure("model_settings_required");

  const verticalPolicy = VERTICALS[vertical];
  const prompt = renderPrompt({
    vertical,
    durationSeconds,
    camera: verticalPolicy.camera,
    motion: verticalPolicy.motion,
    overlaySide,
  });
  if (/\{[A-Z_]+\}/.test(prompt)) return failure("prompt_render_incomplete");

  const promptSha256 = hash(prompt);
  const negativePromptSha256 = hash(NEGATIVE_PROMPT);
  const cacheContract = {
    policyVersion: POLICY_VERSION,
    prospectId,
    domain,
    sourceSha256,
    sourceType,
    sourceAssetType,
    vertical,
    overlaySide,
    preset: presetName,
    durationSeconds,
    modelId,
    modelRevision,
    modelSettings: settings.value,
    promptSha256,
    negativePromptSha256,
  };
  const cacheKey = `wan-hero:${POLICY_VERSION}:${hash(stableSerialize(cacheContract))}`;

  return {
    ok: true,
    policyVersion: POLICY_VERSION,
    promptPackArchiveSha256: PROMPT_PACK_ARCHIVE_SHA256,
    prospectId,
    domain,
    source: { sha256: sourceSha256, type: sourceType, assetType: sourceAssetType },
    vertical,
    overlaySide,
    preset: presetName,
    durationSeconds,
    model: { id: modelId, revision: modelRevision, settings: settings.value },
    prompt,
    negativePrompt: NEGATIVE_PROMPT,
    promptSha256,
    negativePromptSha256,
    cacheKey,
    peopleSensitive,
    fencingSignals,
  };
}

module.exports = {
  POLICY_VERSION,
  PROMPT_PACK_ARCHIVE_SHA256,
  WAN_MODEL_ID,
  WAN_MODEL_REVISION,
  WAN_DEFAULT_SETTINGS,
  WAN_REMASTER_RECIPE,
  WAN_REMASTER_RECIPE_SHA256,
  ALLOWED_VERTICALS,
  ALLOWED_SOURCE_TYPES,
  ALLOWED_OVERLAY_SIDES,
  PEOPLE_SENSITIVE_VERTICALS,
  SPORT_FENCING_SIGNAL_PATTERNS,
  defaultWanGeneration,
  buildWanHeroPolicy,
  normalizeDomain,
  normalizeSha256,
  stableSerialize,
};
