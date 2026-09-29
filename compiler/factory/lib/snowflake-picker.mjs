// factory/lib/snowflake-picker.mjs
// Ferrari-bag slot picker with resonance weighting, vocabulary directives,
// and anti-repetition Hamming gate.
//
// Contract: produces a `compose_plan` matching build-complete.v1.schema.json.
// Same input + same recent-history + same seed = same plan (deterministic).
// Different inputs or a different anti-repetition history = different plan.

import crypto from 'node:crypto';
import { visualAxisSignature } from './snowflake-to-premier.mjs';

// The 10 compose slots — order matters for Hamming compare.
export const SLOTS = [
  'archetype',
  'widget',
  'typography_pair',
  'palette_family',
  'section_cadence_signature',   // a stable hash of the ordered section list
  'motion_grammar',
  'media_treatment',
  'card_geometry',
  'trust_spine',
  'cta_grammar',
];

// Public so the crosswalk and contract tests can prove the active pool stays
// broad enough for LAST_N=8 durable history without exhausting typography.
// Every option must have a matching entry in snowflake-to-premier.mjs.
export const TYPOGRAPHY_OPTIONS = Object.freeze([
  'Fraunces + Inter Tight',
  'Playfair + Plus Jakarta Sans',
  'Cormorant Garamond + Inter',
  'Space Grotesk + JetBrains Mono',
  'Bricolage Grotesque + Inter',
  'Newsreader + Space Grotesk',
  'Instrument Serif + Inter',
  'DM Serif Display + DM Sans',
  'IBM Plex Serif + IBM Plex Sans',
  'Bodoni Moda + Roboto',
  'Oswald + Merriweather',
  'Lora + Work Sans',
  'Sora + Nunito Sans',
  'Alegreya + Alegreya Sans',
  'Roboto Slab + Source Sans 3',
  'Urbanist + Noto Serif',
  'Syne + Inter',
  'Archivo Black + IBM Plex Sans',
]);

// Full slot pools. Each pool entry names an option. Verticals filter these
// via allowed[]; resonance and directives adjust weights.
const POOLS = {
  archetype: [
    'cinematic-console', 'atlas-authority', 'materials-lab', 'editorial-portfolio',
    'owner-letter', 'cinemagraph-immersive', 'luxury-cinematic', 'cream-paper',
    'dark-editorial', 'blueprint-schematic', 'split-cinematic', 'magazine-owner',
    'bento-configurator'
  ],
  widget: [
    '3-step-tile-configurator', 'live-worksite-feed', 'repair-path-console',
    'instant-quote-slider', 'service-atlas-live', 'storm-triage',
    'job-command-urgency', 'materials-swatch-lab', 'seasonal-window-calendar',
    'curb-appeal-quote', 'comfort-score', 'symptom-triage',
    'yardage-estimator', 'urgency-slider-plan-today', 'gamified-tile-configurator',
    'response-time-live-widget'
  ],
  typography_pair: TYPOGRAPHY_OPTIONS,
  palette_family: [
    'dark-cinematic-gold', 'cream-paper-oxblood', 'blueprint-navy',
    'forest-cream', 'oxblood-cream', 'cobalt-black', 'dune-terracotta',
    'arctic-electric', 'monochrome-hi-contrast', 'deep-emerald'
  ],
  section_cadence_signature: [
    'slow-editorial', 'fast-conversion', 'atlas-first', 'proof-first',
    'hero-router-first', 'gallery-forward', 'testimony-forward', 'calendar-driven'
  ],
  motion_grammar: [
    'reveal-slow-fade', 'parallax-multiplane', 'mouse-spotlight',
    'particle-drift', 'cursor-trail', 'scroll-cinemascope',
    'magnetic-hover', 'tilt-3d', 'ripple-water', 'static-restrained'
  ],
  media_treatment: [
    'ken-burns-restrained', 'duotone-brand', 'cinemagraph-single-motion',
    'video-loop-cinematic', 'blueprint-overlay', 'grain-analog',
    'halftone-editorial', 'split-tone'
  ],
  card_geometry: [
    'glassmorphic-frosted', 'liquid-glass-refractive', 'ledger-cream',
    'blueprint-tech', 'monolith-dark', 'editorial-paper',
    'ticket-stamped', 'hexagonal'
  ],
  trust_spine: [
    'stat-band-4up', 'marquee-institutional-logos', 'signed-owner-letter',
    'license-badge-ribbon', 'review-carousel-attributed',
    'before-after-slider', 'video-testimonial-wall', 'live-verified-pulsing'
  ],
  cta_grammar: [
    'primary-solid-accent + phone-outline',
    'dual-router-modal + phone-sticky',
    'single-hero-cta + text-photo',
    'three-tier-ladder',
    'sticky-quote-panel'
  ],
};

// Deterministic seeded RNG (mulberry32) — same seed = same picks
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(input) {
  const key = [input.slug || '', input.vertical || '', input.retryCounter || 0].join(':');
  const hash = crypto.createHash('sha256').update(key).digest();
  return hash.readUInt32BE(0);
}

function weightedPick(pool, rng, weights = {}) {
  const items = pool.map((k) => ({ k, w: weights[k] ?? 1 }));
  const total = items.reduce((s, i) => s + Math.max(0, i.w), 0) || items.length;
  let r = rng() * total;
  for (const it of items) {
    r -= Math.max(0, it.w);
    if (r <= 0) return it.k;
  }
  return items[items.length - 1].k;
}

// Apply resonance profile + vocabulary directives to slot pool weights.
function buildWeights(pool, slot, resonance, directives, vertical) {
  const w = Object.fromEntries(pool.map((k) => [k, 1]));

  // Vocabulary directive biases
  const bias = (key, value) => { if (pool.includes(value)) w[value] = (w[value] || 1) + key; };
  const biasList = (key, list) => (list || []).forEach((v) => bias(key, v));
  biasList(2.5, directives[`${slot}_bias`]);
  biasList(1.5, directives[`archetype_bias`] || []);          // shared alias for slot=archetype
  biasList(1.5, directives[`palette.family_bias`] || []);      // shared alias for slot=palette_family
  biasList(1.5, directives[`typography.display_family_bias`] || []); // acts on typography_pair by family match
  if (slot === 'typography_pair' && directives['typography.display_family_bias']) {
    for (const fam of directives['typography.display_family_bias']) {
      for (const p of pool) if (p.startsWith(fam)) w[p] = (w[p] || 1) + 1.5;
    }
  }

  // Resonance biases (Nielsen-Norman 4-axis)
  if (resonance) {
    if (slot === 'motion_grammar') {
      if (resonance.matter_of_fact_enthusiastic < 30) w['static-restrained'] += 2;
      if (resonance.matter_of_fact_enthusiastic > 70) w['scroll-cinemascope'] += 2;
    }
    if (slot === 'typography_pair') {
      if (resonance.formal_casual < 35) {
        for (const p of pool) if (/Fraunces|Cormorant|Newsreader|Playfair|Instrument|Editorial New/.test(p)) w[p] += 1.5;
      }
    }
    if (slot === 'trust_spine' && resonance.confidence > 70) {
      w['license-badge-ribbon'] = (w['license-badge-ribbon'] || 1) + 2;
      w['stat-band-4up'] = (w['stat-band-4up'] || 1) + 1.5;
    }
  }

  return w;
}

function verticalConstraint(pool, slot, vertical) {
  // Prune widget pool by vertical family. Never let a martial-arts hero
  // pair with a Sparkle Estimator.
  if (slot !== 'widget' || !vertical) return pool;
  const table = {
    'landscape.hardscape': ['3-step-tile-configurator', 'materials-swatch-lab', 'seasonal-window-calendar', 'curb-appeal-quote', 'service-atlas-live', 'yardage-estimator'],
    'landscape.tree-service': ['job-command-urgency', 'urgency-slider-plan-today', 'yardage-estimator', 'service-atlas-live'],
    'landscape.paving-asphalt': ['seasonal-window-calendar', 'service-atlas-live', 'curb-appeal-quote'],
    'roofing': ['storm-triage', 'urgency-slider-plan-today', 'service-atlas-live', 'seasonal-window-calendar'],
    'hvac': ['comfort-score', 'seasonal-window-calendar', 'urgency-slider-plan-today', 'service-atlas-live'],
    'plumbing': ['urgency-slider-plan-today', 'symptom-triage', 'service-atlas-live'],
    'auto.repair': ['repair-path-console', 'symptom-triage', 'service-atlas-live'],
    'home-repair.handyman': ['3-step-tile-configurator', 'live-worksite-feed', 'service-atlas-live'],
    'photography': ['gamified-tile-configurator', '3-step-tile-configurator'],
    'wellness': ['symptom-triage', 'seasonal-window-calendar'],
    'luxury.transport': ['3-step-tile-configurator', 'service-atlas-live'],
    'manufacturing': ['instant-quote-slider', 'service-atlas-live'],
  };
  const family = Object.keys(table).find((k) => vertical.startsWith(k));
  return family ? pool.filter((p) => table[family].includes(p)) : pool;
}

// Hamming distance between two compose plans, counted over SLOTS.
export function hamming(a, b) {
  let diff = 0;
  for (const slot of SLOTS) if ((a?.[slot] ?? null) !== (b?.[slot] ?? null)) diff++;
  return diff;
}

// Custom error the pipeline catches to stop rendering when the anti-repetition
// gate cannot be satisfied. Correction #4: exhausted retries MUST stop
// rendering, not silently produce a lookalike.
export class SnowflakeGateExhaustedError extends Error {
  constructor(message, { vertical, attempts, minHamming } = {}) {
    super(message);
    this.name = 'SnowflakeGateExhaustedError';
    this.code = 'SNOWFLAKE_MIN_HAMMING_UNMET_AFTER_RETRIES';
    this.vertical = vertical;
    this.attempts = attempts;
    this.minHamming = minHamming;
    this.retriable = false;  // per contracts/retry-idempotency.md Bucket 3
  }
}

function usedCriticalAxes(recentPlans) {
  const signatures = recentPlans.map(visualAxisSignature);
  const used = {
    archetype: new Set(),
    composition_base: new Set(),
    hero_family: new Set(),
    media_treatment: new Set(),
    typography_pair: new Set(),
    section_cadence_signature: new Set(),
  };
  for (const signature of signatures) {
    for (const key of Object.keys(used)) {
      if (signature[key]) used[key].add(signature[key]);
    }
  }
  return used;
}

function preferUnusedCriticalAxes(pool, slot, used) {
  if (slot === 'archetype') {
    const scored = pool.map((value) => {
      const signature = visualAxisSignature({ archetype: value });
      const score = Number(!used.archetype.has(value))
        + Number(!used.composition_base.has(signature.composition_base))
        + Number(!used.hero_family.has(signature.hero_family));
      return { value, score };
    });
    const best = Math.max(...scored.map(({ score }) => score));
    return best > 0
      ? scored.filter(({ score }) => score === best).map(({ value }) => value)
      : pool;
  }

  const criticalAxis = {
    media_treatment: 'media_treatment',
    typography_pair: 'typography_pair',
    section_cadence_signature: 'section_cadence_signature',
  }[slot];
  if (!criticalAxis) return pool;
  const unused = pool.filter((value) => !used[criticalAxis].has(value));
  return unused.length ? unused : pool;
}

// The main entry — plan a snowflake site.
export function planSnowflake({ input, resonance = null, directives = {}, recentPlansSameVertical = [] }, { minHamming = 5, maxRetries = 3, throwOnExhaustion = false } = {}) {
  let retry = 0;
  let seed = seedFrom(input);
  let plan;
  let attempts = [];
  const used = usedCriticalAxes(recentPlansSameVertical);

  while (retry < maxRetries + 1) {
    const rng = mulberry32(seed + retry * 1013904223);
    plan = {};
    for (const slot of SLOTS) {
      const sourcePool = preferUnusedCriticalAxes(POOLS[slot], slot, used);
      const pool = verticalConstraint(sourcePool, slot, input.vertical);
      const weights = buildWeights(pool, slot, resonance, directives, input.vertical);
      plan[slot] = weightedPick(pool, rng, weights);
    }
    // Check anti-repetition
    const minDist = recentPlansSameVertical.length === 0
      ? SLOTS.length
      : Math.min(...recentPlansSameVertical.map((p) => hamming(plan, p)));
    attempts.push({ retry, minDist, plan: { ...plan } });
    if (minDist >= minHamming) {
      return {
        plan,
        seed,
        retries: retry,
        min_hamming_to_recent: minDist,
        gate_passed: true,
        attempts,
      };
    }
    retry++;
  }

  // Exhausted retries — correction #4: caller MUST decide to stop render.
  const last = attempts[attempts.length - 1];
  const result = {
    plan: last.plan,
    seed,
    retries: retry,
    min_hamming_to_recent: last.minDist,
    gate_passed: false,
    attempts,
  };
  if (throwOnExhaustion) {
    throw new SnowflakeGateExhaustedError(
      `Snowflake gate exhausted after ${retry} retries (min hamming ${last.minDist} < ${minHamming}) for vertical=${input.vertical}`,
      { vertical: input.vertical, attempts, minHamming }
    );
  }
  return result;
}

// Generate the stable generation_fingerprint for the response envelope.
export function generationFingerprint({ compose_plan, truth_packet_version, renderer }) {
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
