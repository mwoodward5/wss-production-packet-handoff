// Local browser mirror of the reference contract; validation rules unchanged.

const SCHEMA = 'wss-client-site-data-v2';
const SHA256 = /^[a-f0-9]{64}$/i;
const ROOT_PATH = /^\/(?:assets|client)\/[A-Za-z0-9._/-]+$/;
const ROUTE_PATH = /^\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function fail(code, path, detail) {
  const error = new Error(code);
  error.code = code;
  error.path = path;
  if (detail !== undefined) error.detail = detail;
  throw error;
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('client_data_object_required', path);
  return value;
}
function string(value, path, { min = 0, max = 4000, optional = false } = {}) {
  if (value == null && optional) return '';
  if (typeof value !== 'string') fail('client_data_string_required', path);
  const out = value.trim();
  if (out.length < min || out.length > max) fail('client_data_string_length', path, out.length);
  return out;
}
function nullableNumber(value, path, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('client_data_number_required', path);
  if (integer && !Number.isSafeInteger(value)) fail('client_data_integer_required', path);
  if (value < min || value > max) fail('client_data_number_range', path);
  return value;
}
function rootPath(value, path, optional = false) {
  const out = string(value, path, { min: optional ? 0 : 1, max: 300, optional });
  if (!out && optional) return '';
  if (!ROOT_PATH.test(out) || out.includes('..')) fail('client_data_asset_path_invalid', path, out);
  return out;
}
function routePath(value, path, optional = false) {
  const out = string(value, path, { min: optional ? 0 : 1, max: 180, optional });
  if (!out && optional) return '';
  if (!ROUTE_PATH.test(out) || out.includes('..')) fail('client_data_route_path_invalid', path, out);
  return out;
}

function webUrl(value, path, optional = false) {
  const out = string(value, path, { min: optional ? 0 : 1, max: 1200, optional });
  if (!out && optional) return '';
  let url;
  try { url = new URL(out); } catch { fail('client_data_url_invalid', path); }
  if (url.protocol !== 'https:' || url.username || url.password) fail('client_data_url_invalid', path);
  return url.href;
}
function phoneTel(value, path) {
  const out = string(value, path, { min: 7, max: 24 });
  if (!/^tel:\+[1-9][0-9]{6,14}$/.test(out)) fail('client_data_phone_tel_invalid', path);
  return out;
}
function array(value, path, max = 100) {
  if (!Array.isArray(value)) fail('client_data_array_required', path);
  if (value.length > max) fail('client_data_array_too_large', path, value.length);
  return value;
}
function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) frozen(item);
  return Object.freeze(value);
}

function normalizeService(service, index) {
  service = object(service, '/services/' + index);
  return {
    name: string(service.name, '/services/' + index + '/name', { min: 2, max: 140 }),
    shortLabel: string(service.shortLabel || service.name, '/services/' + index + '/shortLabel', { min: 2, max: 48 }),
    description: string(service.description, '/services/' + index + '/description', { min: 20, max: 1800 }),
    href: service.href ? routePath(service.href, '/services/' + index + '/href') : '',
    source: service.source ? object(service.source, '/services/' + index + '/source') : null,
  };
}

function normalizeMedia(item, index) {
  item = object(item, '/media/' + index);
  const role = string(item.role, '/media/' + index + '/role', { min: 2, max: 40 });
  if (!['hero','gallery','people','about','logo'].includes(role)) fail('client_data_media_role_invalid', '/media/' + index + '/role', role);
  const sourceSha = string(item.sourceSha256, '/media/' + index + '/sourceSha256', { min: 64, max: 64 });
  const outputSha = string(item.outputSha256 || sourceSha, '/media/' + index + '/outputSha256', { min: 64, max: 64 });
  if (!SHA256.test(sourceSha) || !SHA256.test(outputSha)) fail('client_data_media_sha_invalid', '/media/' + index);
  return {
    role,
    path: rootPath(item.path, '/media/' + index + '/path'),
    sourceUrl: webUrl(item.sourceUrl, '/media/' + index + '/sourceUrl'),
    sourceSha256: sourceSha.toLowerCase(),
    outputSha256: outputSha.toLowerCase(),
    rank: nullableNumber(item.rank, '/media/' + index + '/rank', { integer: true }),
    width: nullableNumber(item.width, '/media/' + index + '/width', { min: 1, max: 20000, integer: true }),
    height: nullableNumber(item.height, '/media/' + index + '/height', { min: 1, max: 20000, integer: true }),
    originalBytes: item.originalBytes !== false,
  };
}

function normalizeReview(review, index) {
  review = object(review, '/trust/reviews/' + index);
  return {
    author: string(review.author, '/trust/reviews/' + index + '/author', { min: 1, max: 120 }),
    text: string(review.text, '/trust/reviews/' + index + '/text', { min: 10, max: 3000 }),
    rating: nullableNumber(review.rating, '/trust/reviews/' + index + '/rating', { min: 0, max: 5 }),
    sourceUrl: webUrl(review.sourceUrl, '/trust/reviews/' + index + '/sourceUrl'),
  };
}

function normalize(value) {
  value = object(value, '/');
  if (value.schema !== SCHEMA) fail('client_data_schema_invalid', '/schema', value.schema);
  const identity = object(value.identity, '/identity');
  const content = object(value.content, '/content');
  const hero = object(value.hero, '/hero');
  const trust = object(value.trust || {}, '/trust');
  const design = object(value.design || {}, '/design');
  const source = object(value.source || {}, '/source');

  const media = array(value.media || [], '/media', 64).map(normalizeMedia);
  const heroPoster = rootPath(hero.poster, '/hero/poster');
  if (!media.some(m => m.path === heroPoster && m.role === 'hero')) fail('client_data_hero_media_unbound', '/hero/poster');
  const heroVideo = hero.video ? rootPath(hero.video, '/hero/video') : '';

  const services = array(value.services || [], '/services', 30).map(normalizeService);
  if (!services.length) fail('client_data_services_required', '/services');

  const normalized = {
    schema: SCHEMA,
    identity: {
      businessName: string(identity.businessName, '/identity/businessName', { min: 2, max: 160 }),
      city: string(identity.city, '/identity/city', { min: 1, max: 120 }),
      state: string(identity.state, '/identity/state', { min: 2, max: 80 }),
      phoneDisplay: string(identity.phoneDisplay, '/identity/phoneDisplay', { min: 7, max: 40 }),
      phoneTel: phoneTel(identity.phoneTel, '/identity/phoneTel'),
      email: string(identity.email || '', '/identity/email', { max: 320, optional: true }),
      website: webUrl(identity.website, '/identity/website'),
      founded: nullableNumber(identity.founded, '/identity/founded', { min: 1600, max: 2200, integer: true }),
      logoOnDark: rootPath(identity.logoOnDark, '/identity/logoOnDark'),
      logoOnLight: rootPath(identity.logoOnLight, '/identity/logoOnLight'),
    },
    hero: {
      line1: string(hero.line1, '/hero/line1', { min: 2, max: 80 }),
      emphasis: string(hero.emphasis, '/hero/emphasis', { min: 2, max: 80 }),
      line3: string(hero.line3, '/hero/line3', { min: 2, max: 80 }),
      eyebrow: string(hero.eyebrow, '/hero/eyebrow', { min: 2, max: 100 }),
      support: string(hero.support, '/hero/support', { min: 20, max: 900 }),
      poster: heroPoster,
      video: heroVideo,
    },
    services,
    media,
    content: {
      serviceIntro: string(content.serviceIntro, '/content/serviceIntro', { min: 10, max: 800 }),
      about: string(content.about, '/content/about', { min: 20, max: 2400 }),
      seasonalNote: string(content.seasonalNote || '', '/content/seasonalNote', { max: 160, optional: true }),
      whyHeadline: string(content.whyHeadline || '', '/content/whyHeadline', { max: 180, optional: true }),
      ctaHeadline: string(content.ctaHeadline || '', '/content/ctaHeadline', { max: 220, optional: true }),
      ctaBody: string(content.ctaBody || '', '/content/ctaBody', { max: 900, optional: true }),
      values: array(content.values || [], '/content/values', 8).map((item, i) => {
        item = object(item, '/content/values/' + i);
        return {
          title: string(item.title, '/content/values/' + i + '/title', { min: 2, max: 120 }),
          body: string(item.body, '/content/values/' + i + '/body', { min: 10, max: 900 }),
        };
      }),
      faqs: array(content.faqs || [], '/content/faqs', 20).map((item, i) => {
        item = object(item, '/content/faqs/' + i);
        return {
          q: string(item.q, '/content/faqs/' + i + '/q', { min: 4, max: 280 }),
          a: string(item.a, '/content/faqs/' + i + '/a', { min: 10, max: 1800 }),
        };
      }),
    },
    trust: {
      reviews: array(trust.reviews || [], '/trust/reviews', 30).map(normalizeReview),
      aggregate: trust.aggregate ? {
        rating: nullableNumber(trust.aggregate.rating, '/trust/aggregate/rating', { min: 0, max: 5 }),
        count: nullableNumber(trust.aggregate.count, '/trust/aggregate/count', { min: 1, max: 10000000, integer: true }),
        sourceUrl: webUrl(trust.aggregate.sourceUrl, '/trust/aggregate/sourceUrl'),
      } : null,
      hours: trust.hours || null,
      areas: array(trust.areas || [], '/trust/areas', 100).map((x, i) => string(x, '/trust/areas/' + i, { min: 1, max: 160 })),
      socials: array(trust.socials || [], '/trust/socials', 30).map((x, i) => webUrl(x, '/trust/socials/' + i)),
      badges: array(trust.badges || [], '/trust/badges', 30).map((b, i) => {
        b = object(b, '/trust/badges/' + i);
        return {
          label: string(b.label, '/trust/badges/' + i + '/label', { min: 1, max: 160 }),
          sublabel: string(b.sublabel || '', '/trust/badges/' + i + '/sublabel', { max: 240, optional: true }),
          meta: string(b.meta || '', '/trust/badges/' + i + '/meta', { max: 240, optional: true }),
        };
      }),
      stats: array(trust.stats || [], '/trust/stats', 30),
      bookingUrl: trust.bookingUrl ? webUrl(trust.bookingUrl, '/trust/bookingUrl') : '',
      mapUrl: trust.mapUrl ? webUrl(trust.mapUrl, '/trust/mapUrl') : '',
    },
    design: {
      paletteSource: string(design.paletteSource || 'donor-default', '/design/paletteSource', { min: 2, max: 100 }),
      accent: string(design.accent || '', '/design/accent', { max: 16, optional: true }),
      fonts: array(design.fonts || [], '/design/fonts', 8).map((x, i) => string(x, '/design/fonts/' + i, { min: 1, max: 100 })),
    },
    trustModules: array(value.trustModules || [], '/trustModules', 40).map((x, i) => string(x, '/trustModules/' + i, { min: 2, max: 80 })),
    source: {
      prospectId: string(source.prospectId, '/source/prospectId', { min: 3, max: 160 }),
      compiledAt: string(source.compiledAt, '/source/compiledAt', { min: 10, max: 80 }),
      packetSha256: string(source.packetSha256, '/source/packetSha256', { min: 64, max: 64 }).toLowerCase(),
      packetVersion: string(source.packetVersion, '/source/packetVersion', { min: 2, max: 100 }),
    },
  };
  if (!SHA256.test(normalized.source.packetSha256)) fail('client_data_packet_sha_invalid', '/source/packetSha256');
  return frozen(normalized);
}

export { SCHEMA, normalize, fail };
