'use strict';

const path = require('node:path');

const KIT_IDS = Object.freeze([
  'answer-block',
  'badge-mosaic-shimmer',
  'before-after-reveal',
  'booking-momentum',
  'breadcrumb-site-graph',
  'citation-footer',
  'coverflow-carousel',
  'emergency-response-bar',
  'entity-card',
  'faq-how-to-schema',
  'holo-badge',
  'instant-quote-estimator',
  'liquid-morph-slider',
  'local-business-schema',
  'local-landmark-proof',
  'magnetic-stack',
  'near-me-hero',
  'open-now-widget',
  'orbiting-trust-ring',
  'quotable-facts-strip',
  'rating-orb',
  'review-schema-bridge',
  'service-area-answer-grid',
  'service-area-map-explorer',
  'service-schema-set',
  'speed-vitals-guard',
  'stacked-deck-swipe',
  'star-constellation',
  'stat-odometer',
  'tap-to-call-rail',
  'ticker-bar',
  'typewriter-spotlight',
  'vault-reveal',
]);

const NATIVE_IDS = Object.freeze([
  'native-review-marquee',
  'native-rating-strip',
  'native-trust-float',
  'native-social-row',
  'native-nap',
  'native-local-map',
  'native-review-cta',
]);

const ALL_IDS = Object.freeze([...KIT_IDS, ...NATIVE_IDS]);

if (ALL_IDS.length !== 40 || new Set(ALL_IDS).size !== 40) {
  throw new Error('trust_registry_must_have_exactly_40_unique_modules');
}

const CLASS = Object.freeze({
  'native-review-marquee': 'reviews',
  'native-rating-strip': 'reviews',
  'native-trust-float': 'badges',
  'native-social-row': 'social',
  'native-nap': 'local',
  'native-local-map': 'local',
  'native-review-cta': 'reviews',
});

function kitPath(id) {
  if (!KIT_IDS.includes(id)) return null;
  return path.join(__dirname, 'modules', 'live-kit', id + '.js');
}

function loadKit(id) {
  const file = kitPath(id);
  if (!file) return null;
  const mod = require(file);
  if (!mod || mod.name !== id) throw new Error('trust_module_identity_mismatch:' + id);
  return mod;
}

function nativeProof(id, client) {
  const trust = client?.trust || {};
  const identity = client?.identity || {};
  switch (id) {
    case 'native-review-marquee':
      return Array.isArray(trust.reviews) && trust.reviews.length >= 3;
    case 'native-rating-strip':
      return !!(trust.aggregate && Number.isFinite(trust.aggregate.rating) && Number.isSafeInteger(trust.aggregate.count));
    case 'native-trust-float':
      return Array.isArray(trust.badges) && trust.badges.length > 0;
    case 'native-social-row':
      return Array.isArray(trust.socials) && trust.socials.length > 0;
    case 'native-nap':
      return !!(identity.businessName && identity.phoneTel && identity.city && identity.state);
    case 'native-local-map':
      return !!trust.mapUrl;
    case 'native-review-cta':
      return !!(trust.aggregate?.sourceUrl || trust.reviews?.some?.(x => x.sourceUrl));
    default:
      return false;
  }
}

function kitContext(client, enabledIds, mode = {}) {
  const flags = {};
  for (const id of enabledIds) flags['kit_' + id.replace(/-/g, '_')] = true;
  const trust = client.trust || {};
  return {
    donor: { flags },
    business: {
      name: client.identity.businessName,
      phone: client.identity.phoneDisplay,
      city: client.identity.city,
      state: client.identity.state,
      website: client.identity.website,
      reviewAggregate: trust.aggregate ? { rating: trust.aggregate.rating, count: trust.aggregate.count } : null,
    },
    data: {
      aggregate: trust.aggregate ? { rating: trust.aggregate.rating, count: trust.aggregate.count } : null,
      reviews: (trust.reviews || []).map(r => ({
        name: r.author,
        author: r.author,
        quote: r.text,
        text: r.text,
        rating: r.rating,
        source_url: r.sourceUrl,
        review_url: r.sourceUrl,
      })),
      badges: trust.badges || [],
      stats: trust.stats || [],
      hours: trust.hours,
      serviceAreas: trust.areas || [],
      areas: trust.areas || [],
      socials: trust.socials || [],
      bookingUrl: trust.bookingUrl || '',
      mapUrl: trust.mapUrl || '',
      identity: client.identity,
      services: client.services,
      facts: {
        business_name: client.identity.businessName,
        city: client.identity.city,
        state: client.identity.state,
        phone: client.identity.phoneDisplay,
        website: client.identity.website,
        founded: client.identity.founded,
      },
    },
    mode: { mobile: mode.mobile === true },
  };
}

function availableModules(client, preferences = ALL_IDS, mode = {}) {
  const preferred = preferences.filter(id => ALL_IDS.includes(id));
  const ctx = kitContext(client, preferred, mode);
  const out = [];
  for (const id of preferred) {
    if (KIT_IDS.includes(id)) {
      const mod = loadKit(id);
      let css = '', js = null;
      try {
        css = typeof mod.css === 'function' ? mod.css(ctx) : '';
        js = typeof mod.js === 'function' ? mod.js(ctx) : null;
      } catch (error) {
        const wrapped = new Error('trust_module_evaluation_failed:' + id);
        wrapped.cause = error;
        throw wrapped;
      }
      if (css || js) out.push({ id, kind: 'kit', class: mod.class || 'other', css: css || '', js: js || '' });
    } else if (nativeProof(id, client)) {
      out.push({ id, kind: 'native', class: CLASS[id] || 'other', css: '', js: '' });
    }
  }
  return out;
}

module.exports = Object.freeze({
  KIT_IDS,
  NATIVE_IDS,
  ALL_IDS,
  loadKit,
  nativeProof,
  kitContext,
  availableModules,
});
