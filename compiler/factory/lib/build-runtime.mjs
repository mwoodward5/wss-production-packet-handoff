// factory/lib/build-runtime.mjs
// Wires build-request.v1 into the SiteForge runtime and produces a
// contract-validated build-complete.v1 response. Correction #5.
// The injected runPremier provider adapts these inputs to the real V8
// renderer; tests can replace that provider without changing orchestration.

import { randomUUID } from 'node:crypto';

import { hamming, planSnowflake, SLOTS } from './snowflake-picker.mjs';
import { toPremierInputs, CROSSWALK, RENDERER_ID, QC_CONTRACT, generationFingerprint as adapter_fingerprint } from './snowflake-to-premier.mjs';
import { LAST_N, loadHistory, appendPlan, extractPlans } from './vertical-history.mjs';
import { validateBuildComplete } from './build-response-validator.mjs';
import { selectVerifiedBusinessTypography } from '../pipeline/05-build-v8.mjs';

export const RENDERER_VERSION = '8.2.0';
export const AUTHORITY_PROFILE_VERSION = 'authority-108-v1';
export const TRUTH_PACKET_VERSION = 'siteforge-truth-packet-v1';
const RESERVATION_TTL_MS = 5 * 60 * 1000;
const RESERVATION_RENEW_INTERVAL_MS = 60 * 1000;

// Translate the inbound build-request.v1 truth_packet into the internal
// input shape the snowflake picker + Premier composer both understand.
//
// This function ONLY renames fields and coerces types. It never invents
// facts. If a required field is missing from the request, throws.
export function normalizeTruthPacket(req) {
  const tp = req?.truth_packet;
  if (!tp) throw new Error('build-request.v1 missing truth_packet');
  const required = ['business_name', 'city', 'state', 'vertical'];
  for (const k of required) {
    if (!tp[k]) throw new Error(`build-request.v1.truth_packet missing ${k}`);
  }
  return {
    slug: slugify(tp.business_name),
    business_name: tp.business_name,
    legal_name: tp.legal_name || null,
    city: tp.city,
    state: tp.state,
    postal_code: tp.postal_code || null,
    street_address: tp.street_address || null,
    phone_e164: tp.phone_e164 || null,
    email: tp.email || null,
    website_url: tp.website_url || null,
    google_place_id: tp.google_place_id || null,
    gbp_url: tp.gbp_url || null,
    facebook_url: tp.facebook_url || null,
    instagram_url: tp.instagram_url || null,
    vertical: tp.vertical,
    one_line_description: tp.one_line_description || null,
    services: Array.isArray(tp.services) ? tp.services.slice(0, 24) : [],
    license_credentials: Array.isArray(tp.license_credentials) ? tp.license_credentials : [],
    established_year: tp.established_year || null,
    hours: Array.isArray(tp.hours) ? tp.hours : [],
    service_area_cities: Array.isArray(tp.service_area_cities) ? tp.service_area_cities.slice(0, 32) : [],
  };
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function enrichmentValue(packet, key) {
  const entry = packet?.enrichment_sources?.[key];
  return entry && typeof entry === 'object' && 'value' in entry ? entry.value : null;
}

function preparedBrandFonts(packet) {
  const branding = enrichmentValue(packet, 'branding');
  return [
    packet?.facts?.branding?.fonts,
    packet?.branding?.fonts,
    packet?.brand?.fonts,
    packet?.discovery?.branding?.fonts,
    packet?.discovery?.found?.fonts,
    branding?.fonts,
  ].flatMap((fonts) => Array.isArray(fonts) ? fonts : [])
    .filter((font) => typeof font === 'string')
    .map((font) => font.trim())
    .filter(Boolean);
}

// Prepared packets are the internal shape used by Studio, try-on, the CLI,
// and the engine console after discovery/rescue/design. Keep those facts and
// assets in place while exposing the stable planner input used by runBuild.
export function normalizePreparedPacket(packet) {
  const business = packet?.business;
  if (!business || typeof business !== 'object') throw new Error('prepared packet missing business');
  const required = {
    business_name: business.name,
    city: business.city,
    state: business.state,
    vertical: business.category,
  };
  for (const [key, value] of Object.entries(required)) {
    if (!value) throw new Error(`prepared packet missing business.${key === 'business_name' ? 'name' : key === 'vertical' ? 'category' : key}`);
  }
  return {
    slug: packet.slug || slugify(business.name),
    business_name: business.name,
    legal_name: business.legal_name || null,
    city: business.city,
    state: business.state,
    postal_code: business.postal_code || null,
    street_address: business.address || enrichmentValue(packet, 'address') || null,
    phone_e164: business.phone || enrichmentValue(packet, 'phone') || null,
    email: business.email || enrichmentValue(packet, 'email') || null,
    website_url: business.current_website || enrichmentValue(packet, 'website') || null,
    google_place_id: packet.gbp?.pid || enrichmentValue(packet, 'map_id') || null,
    gbp_url: business.gbp_url || null,
    facebook_url: business.facebook_url || null,
    instagram_url: business.instagram_url || null,
    vertical: business.category,
    one_line_description: business.one_line_description || null,
    services: Array.isArray(packet.services) ? packet.services.slice(0, 24) : [],
    license_credentials: Array.isArray(packet.license_credentials) ? packet.license_credentials : [],
    established_year: business.established_year || null,
    hours: Array.isArray(packet.hours) ? packet.hours : [],
    service_area_cities: Array.isArray(packet.service_area_cities) ? packet.service_area_cities.slice(0, 32) : [],
    brand: { fonts: preparedBrandFonts(packet) },
  };
}

function reservedBusinessTypographySlot(input) {
  const pair = selectVerifiedBusinessTypography(input);
  if (!pair) return null;
  return Object.entries(CROSSWALK.typography_pair).find(([, mapped]) => (
    mapped.display === pair.display && mapped.body === pair.body
  ))?.[0] || null;
}

function reserveBusinessTypography(planning, input, recentPlans, minHamming) {
  const typographyPair = reservedBusinessTypographySlot(input);
  if (!typographyPair || planning.plan.typography_pair === typographyPair) return planning;
  const plan = { ...planning.plan, typography_pair: typographyPair };
  const minDist = recentPlans.length === 0
    ? SLOTS.length
    : Math.min(...recentPlans.map((recent) => hamming(plan, recent)));
  // Brand discovery may influence the reserved plan, but it never weakens the
  // anti-repetition gate. If this exact pair would do so, keep the deterministic
  // snowflake fallback selected by the planner.
  if (minDist < minHamming) return planning;
  const attempts = [...planning.attempts];
  attempts[attempts.length - 1] = {
    ...attempts[attempts.length - 1],
    minDist,
    plan: { ...plan },
  };
  return {
    ...planning,
    plan,
    min_hamming_to_recent: minDist,
    attempts,
  };
}

function planReservedSnowflake({ input, resonance, directives, recentPlans }, { minHamming, maxRetries }) {
  const planning = planSnowflake(
    { input, resonance, directives, recentPlansSameVertical: recentPlans },
    { minHamming, maxRetries, throwOnExhaustion: true },
  );
  return reserveBusinessTypography(planning, input, recentPlans, minHamming);
}

export async function planPremierRuntime(input, opts = {}) {
  const {
    store = null,
    minHamming = 5,
    maxRetries = 3,
    resonance = null,
    directives = {},
  } = opts;
  const historyRows = await loadHistory(input.vertical, { store });
  const recent = extractPlans(historyRows);
  const planning = planReservedSnowflake(
    { input, resonance, directives, recentPlans: recent },
    { minHamming, maxRetries },
  );
  const premierInputs = toPremierInputs(planning.plan);
  const generation_fingerprint = adapter_fingerprint({
    compose_plan: planning.plan,
    truth_packet_version: TRUTH_PACKET_VERSION,
    renderer: RENDERER_ID,
  });
  return { planning, premierInputs, generation_fingerprint };
}

function supportsDurableReservations(store) {
  return Boolean(
    store
    && typeof store.reserveVerticalPlan === 'function'
    && typeof store.finalizeVerticalPlan === 'function'
    && typeof store.releaseVerticalPlan === 'function',
  );
}

async function reservePremierRuntime(input, opts = {}) {
  const {
    store = null,
    minHamming = 5,
    maxRetries = 3,
    resonance = null,
    directives = {},
    idempotencyKey = null,
  } = opts;
  if (!supportsDurableReservations(store)) {
    return {
      ...(await planPremierRuntime(input, { store, minHamming, maxRetries, resonance, directives })),
      reservation: null,
    };
  }

  const reservation = await store.reserveVerticalPlan(input.vertical, (recentPlans) => planReservedSnowflake(
    { input, resonance, directives, recentPlans },
    { minHamming, maxRetries },
  ), {
    limit: LAST_N,
    idempotencyKey,
    ttlMs: RESERVATION_TTL_MS,
  });
  const planning = reservation.selection;
  const premierInputs = toPremierInputs(planning.plan);
  const generation_fingerprint = adapter_fingerprint({
    compose_plan: planning.plan,
    truth_packet_version: TRUTH_PACKET_VERSION,
    renderer: RENDERER_ID,
  });
  return { planning, premierInputs, generation_fingerprint, reservation };
}

async function finalizePremierRuntime(vertical, runtime, store, renderedSectionOrder = null) {
  if (runtime.reservation) {
    return store.finalizeVerticalPlan(vertical, runtime.reservation.reservation_id, {
      limit: LAST_N,
      renderedSectionOrder,
    });
  }
  return appendPlan(vertical, runtime.planning.plan, { store });
}

async function releasePremierReservation(vertical, runtime, store, cause) {
  if (!runtime.reservation) return;
  try {
    await store.releaseVerticalPlan(vertical, runtime.reservation.reservation_id);
  } catch (releaseError) {
    cause.release_error = releaseError;
  }
}

function startPremierReservationHeartbeat(vertical, runtime, store, intervalMs = RESERVATION_RENEW_INTERVAL_MS) {
  if (!runtime.reservation || typeof store?.renewVerticalPlan !== 'function') {
    return { async stop() { return null; } };
  }
  const reservationId = runtime.reservation.reservation_id;
  const safeIntervalMs = Math.max(5, Number(intervalMs) || RESERVATION_RENEW_INTERVAL_MS);
  let stopped = false;
  let failure = null;
  let inFlight = Promise.resolve();
  const timer = setInterval(() => {
    inFlight = inFlight.then(async () => {
      if (stopped || failure) return;
      try {
        await store.renewVerticalPlan(vertical, reservationId, { ttlMs: RESERVATION_TTL_MS });
      } catch (error) {
        failure = error;
      }
    });
  }, safeIntervalMs);
  timer.unref?.();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight;
      return failure;
    },
  };
}

// Main runtime entry.
// Callers (api/index.mjs, engine-adapter.mjs) invoke this after intake.
// The `providers` object injects:
//   · store: verticalHistoryStore for the anti-repetition gate
//   · runPremier: (premierInputs, truthPacket, assets) => Promise<premierResult>
//   · idFactory: () => new build_id ULID
//   · now: () => current Date (for testability)
export async function runBuild(req, opts = {}) {
  const {
    providers = {},
    minHamming = 5,
    maxRetries = 3,
    reservationRenewIntervalMs = RESERVATION_RENEW_INTERVAL_MS,
  } = opts;

  const input = normalizeTruthPacket(req);
  if (typeof providers.runPremier !== 'function') {
    throw new Error('runBuild: providers.runPremier is required');
  }
  // Directives from resonance_hint.vocabulary_triggers (if any) — resolved
  // against vocabulary-map.json by the caller before this function runs.
  const directives = req.design_constraints?.directives || {};
  const runtime = await reservePremierRuntime(input, {
    store: providers.store,
    minHamming,
    maxRetries,
    resonance: req._resonance_snapshot || null,
    directives,
    idempotencyKey: req.idempotency_key,
  });
  const { planning, premierInputs, generation_fingerprint } = runtime;

  // Hand off to the actual Premier renderer (unchanged). The renderer emits
  // its internal pc1-* composition fingerprint alongside our 64-hex one.
  const build_id = (providers.idFactory && providers.idFactory()) || `build_${randomUUID()}`;
  const prospect_id = req.prospect_id || (providers.idFactory && providers.idFactory()) || `prosp_${randomUUID()}`;
  const reservationHeartbeat = startPremierReservationHeartbeat(
    input.vertical,
    runtime,
    providers.store,
    reservationRenewIntervalMs,
  );
  let premierResult;
  try {
    premierResult = await providers.runPremier({
      premierInputs,
      truthPacket: input,
      assets: req.assets || {},
      compose_plan: planning.plan,
      idempotency_key: req.idempotency_key,
      build_id,
      prospect_id,
      mode: req.mode || 'single-page-cinematic',
      plan_tier: req.plan_tier,
      batch_hamming_min: planning.min_hamming_to_recent,
      providerOptions: providers.premierOptions,
    });
    const renewalFailure = await reservationHeartbeat.stop();
    if (renewalFailure) throw renewalFailure;
  } catch (error) {
    const renewalFailure = await reservationHeartbeat.stop();
    if (renewalFailure && renewalFailure !== error) error.reservation_renew_error = renewalFailure;
    await releasePremierReservation(input.vertical, runtime, providers.store, error);
    throw error;
  }
  // Assemble the build-complete.v1 payload
  const payload = {
    schema_version: 'siteforge-build-complete-v1',
    build_id: premierResult.build_id,
    prospect_id: premierResult.prospect_id,
    idempotency_key: req.idempotency_key,
    status: 'ready',
    renderer: RENDERER_ID,
    renderer_version: RENDERER_VERSION,
    qc_contract: QC_CONTRACT,
    visual_qc_passed: Boolean(premierResult.visual_qc_passed),
    generation_fingerprint,
    authority_profile_version: AUTHORITY_PROFILE_VERSION,
    truth_packet_version: TRUTH_PACKET_VERSION,
    preview_url: premierResult.preview_url,
    preview_url_owner_only: Boolean(premierResult.preview_url_owner_only ?? true),
    report_url: premierResult.report_url,
    qc_passed: Boolean(premierResult.qc_passed),
    compose_plan: planning.plan,
    logo_provenance: premierResult.logo_provenance,
    media_provenance: premierResult.media_provenance,
    optimization_manifest: premierResult.optimization_manifest,
    completed_at: (opts.now ? opts.now() : new Date()).toISOString(),
  };
  for (const [key, value] of Object.entries({
    report_token: premierResult.report_token,
    qc_summary: premierResult.qc_summary,
    outputs: premierResult.outputs,
    checkout: premierResult.checkout,
  })) {
    if (value !== undefined) payload[key] = value;
  }

  // Contract validation: throws BuildResponseInvalidError on any violation.
  // The pipeline treats a validation failure as a build failure, not a warn.
  try {
    validateBuildComplete(payload);
  } catch (error) {
    await releasePremierReservation(input.vertical, runtime, providers.store, error);
    throw error;
  }
  try {
    await finalizePremierRuntime(input.vertical, runtime, providers.store);
  } catch (error) {
    await releasePremierReservation(input.vertical, runtime, providers.store, error);
    throw error;
  }
  return payload;
}

// Shared internal entry for prepared packets. Public entrypoints keep their
// existing auth, QC, deploy, SSE, and response contracts around this call.
export async function runPreparedBuild(packet, opts = {}) {
  const {
    providers = {},
    minHamming = 5,
    maxRetries = 3,
    resonance = null,
    directives = {},
    reservationRenewIntervalMs = RESERVATION_RENEW_INTERVAL_MS,
  } = opts;
  if (typeof providers.runPremier !== 'function') {
    throw new Error('runPreparedBuild: providers.runPremier is required');
  }

  const input = normalizePreparedPacket(packet);
  const runtime = await reservePremierRuntime(input, {
    store: providers.store,
    minHamming,
    maxRetries,
    resonance,
    directives,
    idempotencyKey: packet.idempotency_key,
  });
  const { planning, premierInputs, generation_fingerprint } = runtime;
  const build_id = packet.build_id || (providers.idFactory && providers.idFactory()) || `build_${randomUUID()}`;
  const prospect_id = packet.prospect_id || (providers.idFactory && providers.idFactory()) || `prosp_${randomUUID()}`;
  const reservationHeartbeat = startPremierReservationHeartbeat(
    input.vertical,
    runtime,
    providers.store,
    reservationRenewIntervalMs,
  );
  let premierResult;
  try {
    premierResult = await providers.runPremier({
      packet,
      premierInputs,
      truthPacket: input,
      assets: opts.assets || {},
      compose_plan: planning.plan,
      build_id,
      prospect_id,
      mode: opts.mode || packet.build_type || 'single-page-cinematic',
      batch_hamming_min: planning.min_hamming_to_recent,
      providerOptions: providers.premierOptions,
    });
    const renewalFailure = await reservationHeartbeat.stop();
    if (renewalFailure) throw renewalFailure;
  } catch (error) {
    const renewalFailure = await reservationHeartbeat.stop();
    if (renewalFailure && renewalFailure !== error) error.reservation_renew_error = renewalFailure;
    await releasePremierReservation(input.vertical, runtime, providers.store, error);
    throw error;
  }
  try {
    await finalizePremierRuntime(input.vertical, runtime, providers.store);
  } catch (error) {
    await releasePremierReservation(input.vertical, runtime, providers.store, error);
    throw error;
  }
  return {
    ...(premierResult || {}),
    build_id,
    prospect_id,
    renderer: RENDERER_ID,
    renderer_version: RENDERER_VERSION,
    qc_contract: QC_CONTRACT,
    compose_plan: planning.plan,
    generation_fingerprint,
    batch_hamming_min: planning.min_hamming_to_recent,
  };
}
