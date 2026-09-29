// factory/lib/build-response-validator.mjs
// Runtime validator for the build-complete.v1 response envelope. Correction #5.
//
// Runs as the final step of the pipeline and blocks the response if it does not
// carry every contract-required field. Never mutates the payload. No dep on ajv.
//
// The full JSON Schema lives at contracts/build-complete.v1.schema.json — this
// validator enforces the enumerated required[] plus type/pattern/const checks
// for the fields that must be exact.

const HEX64 = /^[a-f0-9]{64}$/;

const LOGO_SOURCE_ENUM = Object.freeze([
  'owner-uploaded',
  'firecrawl-scrape',
  'gbp-scrape',
  'procedural-monogram',
  'fallback-textmark',
]);

const LOGO_STAGE_ENUM = Object.freeze([
  'background-removed',
  'upscaled',
  'vectorized',
  'palette-recolored',
  'shimmer-wrapped',
]);

const OPTIMIZATION_STATE_ENUM = Object.freeze([
  'passed',
  'failed',
  'not-applicable',
  'needs-owner-input',
  'runtime-verification',
]);

const REQUIRED_KEYS = Object.freeze([
  'schema_version',
  'build_id',
  'prospect_id',
  'idempotency_key',
  'renderer',
  'renderer_version',
  'authority_profile_version',
  'truth_packet_version',
  'qc_contract',
  'generation_fingerprint',
  'status',
  'preview_url',
  'report_url',
  'qc_passed',
  'visual_qc_passed',
  'logo_provenance',
  'media_provenance',
  'optimization_manifest',
  'completed_at',
]);

const CONST_FIELDS = Object.freeze({
  schema_version:            'siteforge-build-complete-v1',
  renderer:                  'siteforge-renderer-v8-snowflake@8.2.0',
  qc_contract:               'siteforge-qc-v2-authority-108-plus-contamination',
  authority_profile_version: 'authority-108-v1',
});

const STATUS_ENUM = Object.freeze(['ready', 'failed', 'cancelled']);

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function requireFields(value, path, fields, problems) {
  for (const field of fields) {
    if (!(field in value)) problems.push(`missing required field: ${path}.${field}`);
  }
}

function validateLogoProvenance(value, problems) {
  if (!isObject(value)) {
    problems.push('logo_provenance must be an object');
    return;
  }

  requireFields(value, 'logo_provenance', ['source', 'verified', 'stages_applied'], problems);

  if ('source' in value && !LOGO_SOURCE_ENUM.includes(value.source)) {
    problems.push(`logo_provenance.source must be one of ${LOGO_SOURCE_ENUM.join('/')} (got ${JSON.stringify(value.source)})`);
  }
  if ('verified' in value && typeof value.verified !== 'boolean') {
    problems.push('logo_provenance.verified must be boolean');
  }
  if ('stages_applied' in value) {
    if (!Array.isArray(value.stages_applied)) {
      problems.push('logo_provenance.stages_applied must be an array');
    } else {
      for (const [index, stage] of value.stages_applied.entries()) {
        if (!LOGO_STAGE_ENUM.includes(stage)) {
          problems.push(`logo_provenance.stages_applied[${index}] must be one of ${LOGO_STAGE_ENUM.join('/')} (got ${JSON.stringify(stage)})`);
        }
      }
    }
  }
}

function validateMediaProvenance(value, problems) {
  if (!isObject(value)) {
    problems.push('media_provenance must be an object');
    return;
  }

  const countFields = [
    'photos_verified_count',
    'photos_ai_atmosphere_count',
    'photos_dropped_low_quality',
  ];
  requireFields(value, 'media_provenance', countFields, problems);
  for (const field of countFields) {
    if (field in value && !Number.isInteger(value[field])) {
      problems.push(`media_provenance.${field} must be an integer`);
    }
  }

  if ('gallery_photo_urls' in value) {
    if (!Array.isArray(value.gallery_photo_urls)) {
      problems.push('media_provenance.gallery_photo_urls must be an array');
    } else {
      if (value.gallery_photo_urls.length > 12) {
        problems.push(`media_provenance.gallery_photo_urls must have at most 12 items (got ${value.gallery_photo_urls.length})`);
      }
      for (const [index, url] of value.gallery_photo_urls.entries()) {
        if (typeof url !== 'string') {
          problems.push(`media_provenance.gallery_photo_urls[${index}] must be a string`);
        }
      }
    }
  }
}

function validateOptimizationManifest(value, problems) {
  if (!isObject(value)) {
    problems.push('optimization_manifest must be an object');
    return;
  }

  requireFields(value, 'optimization_manifest', ['version', 'checks'], problems);
  if ('version' in value && value.version !== 'authority-108-v1') {
    problems.push(`optimization_manifest.version must equal "authority-108-v1" (got ${JSON.stringify(value.version)})`);
  }
  if (!('checks' in value)) return;
  if (!Array.isArray(value.checks)) {
    problems.push('optimization_manifest.checks must be an array');
    return;
  }
  if (value.checks.length !== 108) {
    problems.push(`optimization_manifest.checks must have length 108 (got ${value.checks.length})`);
  }

  const seenIds = new Set();
  for (const [index, check] of value.checks.entries()) {
    const path = `optimization_manifest.checks[${index}]`;
    if (!isObject(check)) {
      problems.push(`${path} must be an object`);
      continue;
    }

    requireFields(check, path, ['id', 'category', 'label', 'state'], problems);
    if ('id' in check) {
      if (!Number.isInteger(check.id) || check.id < 1 || check.id > 108) {
        problems.push(`${path}.id must be an integer from 1 through 108`);
      } else if (seenIds.has(check.id)) {
        problems.push(`${path}.id duplicates check id ${check.id}`);
      } else {
        seenIds.add(check.id);
      }
    }
    for (const field of ['category', 'label']) {
      if (field in check && (typeof check[field] !== 'string' || check[field].trim() === '')) {
        problems.push(`${path}.${field} must be a nonempty string`);
      }
    }
    if ('state' in check && !OPTIMIZATION_STATE_ENUM.includes(check.state)) {
      problems.push(`${path}.state must be one of ${OPTIMIZATION_STATE_ENUM.join('/')} (got ${JSON.stringify(check.state)})`);
    }
  }
}

function validateQcSummary(value, problems) {
  if (!isObject(value)) {
    problems.push('qc_summary must be an object');
    return;
  }

  requireFields(
    value,
    'qc_summary',
    ['authority_score', 'authority_total', 'hero_layers', 'batch_hamming_min'],
    problems,
  );

  if ('authority_score' in value &&
      (!Number.isInteger(value.authority_score) || value.authority_score < 0 || value.authority_score > 108)) {
    problems.push('qc_summary.authority_score must be an integer from 0 through 108');
  }
  if ('authority_total' in value && value.authority_total !== 108) {
    problems.push('qc_summary.authority_total must equal 108');
  }
  if ('hero_layers' in value && (!Number.isInteger(value.hero_layers) || value.hero_layers < 6)) {
    problems.push('qc_summary.hero_layers must be an integer greater than or equal to 6');
  }
  if ('batch_hamming_min' in value && (!Number.isInteger(value.batch_hamming_min) || value.batch_hamming_min < 5)) {
    problems.push('qc_summary.batch_hamming_min must be an integer greater than or equal to 5');
  }
}

export class BuildResponseInvalidError extends Error {
  constructor(problems) {
    super(`build-complete.v1 validation failed:\n  ${problems.join('\n  ')}`);
    this.name = 'BuildResponseInvalidError';
    this.code = 'BUILD_RESPONSE_CONTRACT_VIOLATION';
    this.problems = problems;
  }
}

export function validateBuildComplete(payload) {
  const problems = [];
  if (!isObject(payload)) {
    throw new BuildResponseInvalidError(['payload is not an object']);
  }
  // Required
  for (const key of REQUIRED_KEYS) {
    if (!(key in payload)) problems.push(`missing required field: ${key}`);
  }
  // Const fields
  for (const [key, value] of Object.entries(CONST_FIELDS)) {
    if (key in payload && payload[key] !== value) {
      problems.push(`field ${key} must equal ${JSON.stringify(value)} (got ${JSON.stringify(payload[key])})`);
    }
  }
  // Status enum
  if ('status' in payload && !STATUS_ENUM.includes(payload.status)) {
    problems.push(`status must be one of ${STATUS_ENUM.join('/')} (got ${JSON.stringify(payload.status)})`);
  }
  // 64-hex fingerprint
  if ('generation_fingerprint' in payload && !HEX64.test(String(payload.generation_fingerprint || ''))) {
    problems.push(`generation_fingerprint must match /^[a-f0-9]{64}$/ (got ${String(payload.generation_fingerprint).slice(0, 20)}...)`);
  }
  if ('logo_provenance' in payload) validateLogoProvenance(payload.logo_provenance, problems);
  if ('media_provenance' in payload) validateMediaProvenance(payload.media_provenance, problems);
  if ('optimization_manifest' in payload) validateOptimizationManifest(payload.optimization_manifest, problems);
  if ('qc_summary' in payload) validateQcSummary(payload.qc_summary, problems);
  // qc booleans
  for (const key of ['qc_passed', 'visual_qc_passed']) {
    if (key in payload && typeof payload[key] !== 'boolean') {
      problems.push(`${key} must be boolean`);
    }
  }
  // Non-empty URLs
  for (const key of ['preview_url', 'report_url']) {
    if (key in payload && !/^https?:\/\//.test(String(payload[key] || ''))) {
      problems.push(`${key} must be an http(s) URL`);
    }
  }

  if (problems.length) throw new BuildResponseInvalidError(problems);
  return true;
}
