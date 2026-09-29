// factory/lib/snowflake-to-premier.mjs
// Adapter that maps a snowflake compose_plan onto the Premier Composition
// engine (05-build-v8.mjs). This adapter DOES NOT replace Premier Composition —
// it only translates snowflake slot picks into the archetype/palette/hero/
// widget/typography inputs Premier already understands.
//
// Contract (per corrections list #2 and #3):
//   · Every snowflake slot MUST map to a real Premier implementation.
//   · Unknown values MUST fail validation, not silently degrade.
//   · The internal pc1-* Premier composition fingerprint is preserved.
//   · The contract-required 64-hex generation_fingerprint is also emitted.

import crypto from 'node:crypto';

// ─── Renderer identity ─────────────────────────────────────────────
export const RENDERER_ID = 'siteforge-renderer-v8-snowflake@8.2.0';
export const RENDERER_BASE = 'siteforge-renderer-v8-premier';  // the composition model underneath
export const QC_CONTRACT = 'siteforge-qc-v2-authority-108-plus-contamination';

// ─── Strict crosswalks ─────────────────────────────────────────────
// Every entry in the snowflake pool must appear here with a valid Premier
// target. Adding a slot value to snowflake-picker.mjs REQUIRES adding a
// crosswalk entry here or the runtime validator will reject the plan.

const HERO_ARCHETYPE_MAP = Object.freeze({
  'cinematic-console':         { premier_archetype: 'cinematic-console-authority',      composition_base: 'signal-workbench',  hero_family: 'cinematic-video-parallax' },
  'atlas-authority':           { premier_archetype: 'atlas-authority-signal',           composition_base: 'terrain-atlas',     hero_family: 'service-map-pins' },
  'materials-lab':             { premier_archetype: 'material-ledger',                  composition_base: 'material-ledger',   hero_family: 'material-lab-swatch' },
  'editorial-portfolio':       { premier_archetype: 'casebook-editorial',               composition_base: 'casebook-editorial',hero_family: 'split-editorial-index' },
  'owner-letter':              { premier_archetype: 'founder-broadsheet',               composition_base: 'founder-broadsheet',hero_family: 'magazine-owner-letter' },
  'cinemagraph-immersive':     { premier_archetype: 'story-assembly',                   composition_base: 'story-assembly',    hero_family: 'cinematic-video-parallax' },
  'luxury-cinematic':          { premier_archetype: 'product-cinema',                   composition_base: 'product-cinema',    hero_family: 'cinematic-video-parallax' },
  'cream-paper':               { premier_archetype: 'clinical-gallery',                 composition_base: 'clinical-gallery',  hero_family: 'split-editorial-index' },
  'dark-editorial':            { premier_archetype: 'signal-workbench',                 composition_base: 'assurance-ledger',  hero_family: 'atlas-grid-reveal' },
  'blueprint-schematic':       { premier_archetype: 'assurance-ledger',                 composition_base: 'survey-section',    hero_family: 'cinematic-video-parallax' },
  'split-cinematic':           { premier_archetype: 'guided-care-path',                 composition_base: 'guided-care-path',  hero_family: 'split-editorial-index' },
  'magazine-owner':            { premier_archetype: 'house-journal',                    composition_base: 'house-journal',     hero_family: 'magazine-owner-letter' },
  'bento-configurator':        { premier_archetype: 'calibrated-service',               composition_base: 'calibrated-service',hero_family: 'atlas-grid-reveal' },
});

const WIDGET_MAP = Object.freeze({
  '3-step-tile-configurator':      { premier_widget: 'homeowner-configurator',     supports_reduced_motion: true },
  'live-worksite-feed':            { premier_widget: 'project-storytelling',       supports_reduced_motion: true },
  'repair-path-console':           { premier_widget: 'homeowner-configurator',     supports_reduced_motion: true },
  'instant-quote-slider':          { premier_widget: 'homeowner-configurator',     supports_reduced_motion: true },
  'service-atlas-live':            { premier_widget: 'service-map',                supports_reduced_motion: true },
  'storm-triage':                  { premier_widget: 'homeowner-configurator',     supports_reduced_motion: true },
  'job-command-urgency':           { premier_widget: 'homeowner-configurator',     supports_reduced_motion: true },
  'materials-swatch-lab':          { premier_widget: 'material-swatch-lab',        supports_reduced_motion: true },
  'seasonal-window-calendar':      { premier_widget: 'process-timeline',           supports_reduced_motion: true },
  'curb-appeal-quote':             { premier_widget: 'homeowner-configurator',     supports_reduced_motion: true },
  'comfort-score':                 { premier_widget: 'homeowner-configurator',     supports_reduced_motion: true },
  'symptom-triage':                { premier_widget: 'homeowner-configurator',     supports_reduced_motion: true },
  'yardage-estimator':             { premier_widget: 'homeowner-configurator',     supports_reduced_motion: true },
  'urgency-slider-plan-today':     { premier_widget: 'homeowner-configurator',     supports_reduced_motion: true },
  'gamified-tile-configurator':    { premier_widget: 'homeowner-configurator',     supports_reduced_motion: true },
  'response-time-live-widget':     { premier_widget: 'process-timeline',           supports_reduced_motion: true },
});

const TYPOGRAPHY_MAP = Object.freeze({
  'Fraunces + Inter Tight':            { display: 'Fraunces', body: 'Inter Tight',           utility: null },
  'Playfair + Plus Jakarta Sans':      { display: 'Playfair Display', body: 'Plus Jakarta Sans', utility: null },
  'Cormorant Garamond + Inter':        { display: 'Cormorant Garamond', body: 'Inter',       utility: null },
  'Space Grotesk + JetBrains Mono':    { display: 'Space Grotesk', body: 'JetBrains Mono',   utility: null },
  'Bricolage Grotesque + Inter':       { display: 'Bricolage Grotesque', body: 'Inter',      utility: null },
  'Newsreader + Space Grotesk':        { display: 'Newsreader', body: 'Space Grotesk',       utility: null },
  'Instrument Serif + Inter':          { display: 'Instrument Serif', body: 'Inter',         utility: null },
  'DM Serif Display + DM Sans':         { display: 'DM Serif Display', body: 'DM Sans',       utility: null },
  'IBM Plex Serif + IBM Plex Sans':     { display: 'IBM Plex Serif', body: 'IBM Plex Sans',   utility: null },
  'Bodoni Moda + Roboto':               { display: 'Bodoni Moda', body: 'Roboto',             utility: null },
  'Oswald + Merriweather':              { display: 'Oswald', body: 'Merriweather',            utility: null },
  'Lora + Work Sans':                   { display: 'Lora', body: 'Work Sans',                 utility: null },
  'Sora + Nunito Sans':                 { display: 'Sora', body: 'Nunito Sans',               utility: null },
  'Alegreya + Alegreya Sans':           { display: 'Alegreya', body: 'Alegreya Sans',        utility: null },
  'Roboto Slab + Source Sans 3':        { display: 'Roboto Slab', body: 'Source Sans 3',      utility: null },
  'Urbanist + Noto Serif':              { display: 'Urbanist', body: 'Noto Serif',            utility: null },
  'Syne + Inter':                       { display: 'Syne', body: 'Inter',                     utility: null },
  'Archivo Black + IBM Plex Sans':      { display: 'Archivo Black', body: 'IBM Plex Sans',    utility: null },
  // Retain validation support for durable plans written before the active
  // Google-font-only pool was expanded. New plans never select these aliases.
  'Editorial New + Suisse':             { display: 'Newsreader', body: 'Work Sans',           utility: null },
  'Migra + Inter':                      { display: 'Bodoni Moda', body: 'Inter',              utility: null },
  'Cardinal Grotesque + Inter':         { display: 'Archivo Black', body: 'Inter',            utility: null },
});

const PALETTE_MAP = Object.freeze({
  'dark-cinematic-gold':      { mode: 'dark',  ink: '#0f0e0b', surface: '#1a1613', accent: '#c99a44', accent_alt: '#e0b355' },
  'cream-paper-oxblood':      { mode: 'light', ink: '#0f0e0b', surface: '#f4efe6', accent: '#a24b23', accent_alt: '#c99a44' },
  'blueprint-navy':           { mode: 'dark',  ink: '#0a1420', surface: '#101d2f', accent: '#4a90e2', accent_alt: '#f5eede' },
  'forest-cream':             { mode: 'light', ink: '#152219', surface: '#ede6d3', accent: '#3e5a3a', accent_alt: '#c99a44' },
  'oxblood-cream':            { mode: 'light', ink: '#1a0d0a', surface: '#efe4d3', accent: '#7c2016', accent_alt: '#c99a44' },
  'cobalt-black':             { mode: 'dark',  ink: '#000005', surface: '#0a0d14', accent: '#3a5bff', accent_alt: '#e8e8ee' },
  'dune-terracotta':          { mode: 'light', ink: '#2a1810', surface: '#f0e3d0', accent: '#b8593a', accent_alt: '#7a5230' },
  'arctic-electric':          { mode: 'light', ink: '#0a1520', surface: '#f2f5f8', accent: '#00a8e8', accent_alt: '#1a3a5c' },
  'monochrome-hi-contrast':   { mode: 'dark',  ink: '#050505', surface: '#f8f8f8', accent: '#e0e0e0', accent_alt: '#999999' },
  'deep-emerald':             { mode: 'dark',  ink: '#0a1a12', surface: '#0f2118', accent: '#22c55e', accent_alt: '#cfe8db' },
});

const CADENCE_MAP = Object.freeze({
  'slow-editorial':           { section_order: ['hero','editorial-split','portfolio-masonry','review-carousel','faq','cta','footer'] },
  'fast-conversion':          { section_order: ['hero','trust-strip','service-grid','review-carousel','cta','footer'] },
  'atlas-first':              { section_order: ['hero','atlas-service-map','service-grid','trust-strip','review-carousel','faq','cta','footer'] },
  'proof-first':              { section_order: ['hero','review-carousel','trust-strip','service-grid','portfolio-masonry','faq','cta','footer'] },
  'hero-router-first':        { section_order: ['hero-with-router','authority-strip','service-grid','atlas-service-map','review-carousel','faq','cta','footer'] },
  'gallery-forward':          { section_order: ['hero','portfolio-masonry','service-grid','trust-strip','review-carousel','faq','cta','footer'] },
  'testimony-forward':        { section_order: ['hero','review-carousel','portfolio-masonry','service-grid','faq','cta','footer'] },
  'calendar-driven':          { section_order: ['hero','seasonal-window','service-grid','trust-strip','review-carousel','faq','cta','footer'] },
});

const MOTION_MAP = Object.freeze({
  'reveal-slow-fade':         { intensity: 1, primary: 'fade-up-24px', ambient: 'none' },
  'parallax-multiplane':      { intensity: 2, primary: 'parallax-3plane', ambient: 'grain' },
  'mouse-spotlight':          { intensity: 2, primary: 'cursor-radial-light', ambient: 'grain' },
  'particle-drift':           { intensity: 3, primary: 'particle-canvas', ambient: 'grain' },
  'cursor-trail':             { intensity: 2, primary: 'cursor-trail-svg', ambient: 'grain' },
  'scroll-cinemascope':       { intensity: 3, primary: 'scroll-scale-hero', ambient: 'grain-veil' },
  'magnetic-hover':           { intensity: 1, primary: 'magnetic-buttons', ambient: 'none' },
  'tilt-3d':                  { intensity: 2, primary: 'tilt-3d-cards', ambient: 'none' },
  'ripple-water':             { intensity: 3, primary: 'ripple-canvas', ambient: 'grain-veil' },
  'static-restrained':        { intensity: 0, primary: 'none', ambient: 'none' },
});

const MEDIA_MAP = Object.freeze({
  'ken-burns-restrained':     { treatment: 'ken-burns',        grain: false },
  'duotone-brand':            { treatment: 'duotone-brand',    grain: false },
  'cinemagraph-single-motion':{ treatment: 'cinemagraph',      grain: false },
  'video-loop-cinematic':     { treatment: 'video-loop',       grain: true  },
  'blueprint-overlay':        { treatment: 'blueprint-svg',    grain: false },
  'grain-analog':             { treatment: 'grain-only',       grain: true  },
  'halftone-editorial':       { treatment: 'halftone',         grain: false },
  'split-tone':               { treatment: 'split-tone',       grain: false },
});

const CARD_GEOMETRY_MAP = Object.freeze({
  'glassmorphic-frosted':     { style: 'glass', backdrop_filter: 'blur(24px) saturate(1.6)' },
  'liquid-glass-refractive':  { style: 'glass', backdrop_filter: 'blur(32px) saturate(1.8)' },
  'ledger-cream':             { style: 'paper', backdrop_filter: 'none' },
  'blueprint-tech':           { style: 'tech',  backdrop_filter: 'none' },
  'monolith-dark':            { style: 'monolith', backdrop_filter: 'none' },
  'editorial-paper':          { style: 'paper', backdrop_filter: 'none' },
  'ticket-stamped':           { style: 'ticket', backdrop_filter: 'none' },
  'hexagonal':                { style: 'hexagonal', backdrop_filter: 'none' },
});

const TRUST_SPINE_MAP = Object.freeze({
  'stat-band-4up':                     { blocks: ['stat-band-4up'] },
  'marquee-institutional-logos':       { blocks: ['marquee-institutional-logos'] },
  'signed-owner-letter':               { blocks: ['signed-owner-letter'] },
  'license-badge-ribbon':              { blocks: ['license-badge-ribbon'] },
  'review-carousel-attributed':        { blocks: ['review-carousel-attributed'] },
  'before-after-slider':               { blocks: ['before-after-slider'] },
  'video-testimonial-wall':            { blocks: ['video-testimonial-wall'] },
  'live-verified-pulsing':             { blocks: ['live-verified-pulsing'] },
});

const CTA_MAP = Object.freeze({
  'primary-solid-accent + phone-outline':       { primary: 'solid-accent',   secondary: 'phone-outline',  sticky_mobile: 'call-text-start' },
  'dual-router-modal + phone-sticky':           { primary: 'modal-router',   secondary: 'phone-sticky',   sticky_mobile: 'call-text-start' },
  'single-hero-cta + text-photo':               { primary: 'solid-accent',   secondary: 'text-photo',     sticky_mobile: 'call-text-start' },
  'three-tier-ladder':                          { primary: 'tier-1-pdf',     secondary: 'tier-2-consult', sticky_mobile: 'call-text-start' },
  'sticky-quote-panel':                         { primary: 'sticky-quote',   secondary: 'phone-outline',  sticky_mobile: 'call-text-start' },
});

const SLOT_MAPS = Object.freeze({
  archetype:                  HERO_ARCHETYPE_MAP,
  widget:                     WIDGET_MAP,
  typography_pair:            TYPOGRAPHY_MAP,
  palette_family:             PALETTE_MAP,
  section_cadence_signature:  CADENCE_MAP,
  motion_grammar:             MOTION_MAP,
  media_treatment:            MEDIA_MAP,
  card_geometry:              CARD_GEOMETRY_MAP,
  trust_spine:                TRUST_SPINE_MAP,
  cta_grammar:                CTA_MAP,
});

// ─── Adapter API ───────────────────────────────────────────────────

export class SnowflakeAdapterError extends Error {
  constructor(message, { slot, value } = {}) {
    super(message);
    this.name = 'SnowflakeAdapterError';
    this.slot = slot;
    this.value = value;
    this.code = 'ADAPTER_UNKNOWN_SLOT_VALUE';
  }
}

// Validate that every slot value has a known Premier crosswalk. Unknown
// values throw — never silently degrade.
export function validateComposePlan(compose_plan) {
  const errors = [];
  for (const [slot, map] of Object.entries(SLOT_MAPS)) {
    const value = compose_plan?.[slot];
    if (value == null) errors.push(`missing slot: ${slot}`);
    else if (!(value in map)) errors.push(`unknown ${slot}: ${JSON.stringify(value)}`);
  }
  if (errors.length) {
    const first = errors[0];
    const err = new SnowflakeAdapterError(`ComposePlan validation failed: ${errors.join('; ')}`);
    err.errors = errors;
    // Attach the offending slot/value for the first error to help retries.
    const match = /(missing|unknown) (\w+)/.exec(first);
    if (match) { err.slot = match[2]; err.value = compose_plan?.[match[2]]; }
    throw err;
  }
  return true;
}

// Translate a snowflake compose_plan into the Premier composition inputs.
// Every unknown value throws SnowflakeAdapterError.
export function toPremierInputs(compose_plan) {
  validateComposePlan(compose_plan);
  return {
    archetype: HERO_ARCHETYPE_MAP[compose_plan.archetype],
    widget:    WIDGET_MAP[compose_plan.widget],
    typography: TYPOGRAPHY_MAP[compose_plan.typography_pair],
    palette:   PALETTE_MAP[compose_plan.palette_family],
    cadence:   CADENCE_MAP[compose_plan.section_cadence_signature],
    motion:    MOTION_MAP[compose_plan.motion_grammar],
    media:     MEDIA_MAP[compose_plan.media_treatment],
    card:      CARD_GEOMETRY_MAP[compose_plan.card_geometry],
    trust:     TRUST_SPINE_MAP[compose_plan.trust_spine],
    cta:       CTA_MAP[compose_plan.cta_grammar],
    // Preserve the internal Premier composition fingerprint alongside
    // the snowflake fingerprint. The pc1-* fingerprint is emitted by the
    // Premier composer itself downstream; this adapter passes the values
    // needed for it and does not overwrite it.
    _slotSourcePlan: { ...compose_plan },
  };
}

// Normalize the axes that materially determine how a site renders. Durable
// history stores the raw compose plan, so deriving these values here lets the
// picker prevent rendered lookalikes without depending on the engine adapter.
export function visualAxisSignature(compose_plan) {
  const mappedArchetype = HERO_ARCHETYPE_MAP[compose_plan?.archetype] || null;
  return {
    archetype: compose_plan?.archetype || null,
    composition_base: mappedArchetype?.composition_base || null,
    hero_family: mappedArchetype?.hero_family || null,
    media_treatment: compose_plan?.media_treatment || null,
    typography_pair: compose_plan?.typography_pair || null,
    section_cadence_signature: compose_plan?.section_cadence_signature || null,
  };
}

// Emit the contract-required 64-hex generation_fingerprint. The internal
// pc1-* fingerprint is emitted separately by Premier composer downstream.
export function generationFingerprint({ compose_plan, truth_packet_version, renderer = RENDERER_ID }) {
  const canonical = JSON.stringify({
    compose_plan: sortObject(compose_plan),
    truth_packet_version,
    renderer,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function sortObject(o) {
  if (Array.isArray(o)) return o.map(sortObject);
  if (o && typeof o === 'object') {
    return Object.keys(o).sort().reduce((acc, k) => { acc[k] = sortObject(o[k]); return acc; }, {});
  }
  return o;
}

// Export the full crosswalk table for tests + docs.
export const CROSSWALK = Object.freeze({
  archetype: HERO_ARCHETYPE_MAP,
  widget: WIDGET_MAP,
  typography_pair: TYPOGRAPHY_MAP,
  palette_family: PALETTE_MAP,
  section_cadence_signature: CADENCE_MAP,
  motion_grammar: MOTION_MAP,
  media_treatment: MEDIA_MAP,
  card_geometry: CARD_GEOMETRY_MAP,
  trust_spine: TRUST_SPINE_MAP,
  cta_grammar: CTA_MAP,
});
