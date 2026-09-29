'use strict';

const { validateRecord } = require('../contracts/genie-packet.cjs');
const { normalize: normalizeClient, SCHEMA } = require('../contracts/client-site-data.cjs');
const { mapPhotoBank } = require('./media-mapper.cjs');
const { select: selectTrust } = require('./trust-adapter.cjs');
const { mapCategory } = require('./category-mapper.cjs');
const { resolveCategory } = require('../categories/donor-catalog-registry.cjs');

function slug(value) {
  return String(value || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function usPhoneDisplay(value) {
  let d = digits(value);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length === 10) return '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6);
  return value;
}

function phoneTel(value) {
  let d = digits(value);
  if (d.length === 10) d = '1' + d;
  if (d.length < 7 || d.length > 15) throw new Error('genie_phone_invalid');
  return 'tel:+' + d;
}

function httpsOrEmpty(value) {
  if (!value) return '';
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : '';
  } catch { return ''; }
}

function verifiedReviews(packet) {
  const candidates = [
    ...(Array.isArray(packet?.trust?.reviews) ? packet.trust.reviews : []),
    ...(Array.isArray(packet?.facts?.testimonials) ? packet.facts.testimonials : []),
  ];
  const out = [];
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'object') continue;
    const author = String(raw.author || raw.name || raw.author_name || '').trim();
    const text = String(raw.text || raw.quote || raw.body || '').trim();
    const sourceUrl = httpsOrEmpty(raw.source_url || raw.review_url || raw.url);
    const evidence = String(raw.evidence || raw.source_excerpt || '').trim();
    const rating = Number(raw.rating);
    if (!author || text.length < 10 || !sourceUrl || !evidence) continue;
    out.push({ author, text, sourceUrl, evidence, rating: Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null });
  }
  return out;
}

function verifiedAggregate(packet, reviews) {
  const rating = Number(packet?.trust?.rating);
  const count = Number(packet?.trust?.review_count);
  const sourceUrl = httpsOrEmpty(
    packet?.trust?.source_url ||
    packet?.trust?.url ||
    reviews[0]?.sourceUrl
  );
  if (!Number.isFinite(rating) || rating < 0 || rating > 5 || !Number.isSafeInteger(count) || count <= 0 || !sourceUrl) return null;
  return { rating, count, sourceUrl };
}

function verifiedBadges(facts) {
  const marks = facts?.discovery?.found?.trust_marks;
  if (!Array.isArray(marks)) return [];
  return marks.filter(x => typeof x === 'string' && x.trim()).map(label => ({ label: label.trim(), sublabel: '', meta: '' }));
}

function verifiedAreas(facts) {
  return depthAreas(facts);
}

function sourcedDepthEntries(facts, channel) {
  const entries = facts?.discovery?.found?.depth_channels?.[channel];
  if (!Array.isArray(entries)) return [];
  return entries.filter(entry => entry && typeof entry === 'object' &&
    httpsOrEmpty(entry.source_url) && typeof entry.evidence === 'string' && entry.evidence.trim());
}

function depthReviews(facts) {
  return sourcedDepthEntries(facts, 'reviews').flatMap(entry => {
    const author = String(entry.author || '').trim();
    const text = String(entry.quote || '').trim();
    if (!author || text.length < 10) return [];
    const rating = Number(entry.rating);
    return [{ author, text, sourceUrl: httpsOrEmpty(entry.source_url), evidence: entry.evidence.trim(),
      rating: Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null }];
  });
}

function depthHours(facts) {
  const entry = sourcedDepthEntries(facts, 'hours').find(x => typeof x.value === 'string' && x.value.trim());
  return entry ? { text: entry.value.trim(), sourceUrl: httpsOrEmpty(entry.source_url), evidence: entry.evidence.trim() } : null;
}

function depthFaqs(facts) {
  return sourcedDepthEntries(facts, 'faqs').flatMap(entry => {
    const q = String(entry.question || '').trim();
    const a = String(entry.answer || '').trim();
    return q.length >= 4 && a.length >= 10 ? [{ q, a, sourceUrl: httpsOrEmpty(entry.source_url), evidence: entry.evidence.trim() }] : [];
  });
}

function depthAreas(facts) {
  return depthAreaSources(facts).map(entry => entry.value);
}

function depthAreaSources(facts) {
  return sourcedDepthEntries(facts, 'areas').flatMap(entry => {
    const value = String(entry.value || '').trim();
    return value ? [{ value, sourceUrl: httpsOrEmpty(entry.source_url), evidence: entry.evidence.trim() }] : [];
  });
}

function verifiedSocials(facts) {
  return Array.isArray(facts?.socials) ? facts.socials.map(httpsOrEmpty).filter(Boolean) : [];
}

function toClientSiteData(recordLike, donorManifest, options = {}) {
  const certified = validateRecord(recordLike);
  const { packet, facts, files, services: certifiedServices, compiledAt, packetSha256, record } = certified;
  const rawCategory = String(facts.category || recordLike.industry || recordLike.vertical || '').trim().toLowerCase();
  const category = resolveCategory(rawCategory) || rawCategory;
  if (category !== donorManifest.category) {
    const error = new Error('spa_v2_category_mismatch');
    error.detail = { packet: category, donor: donorManifest.category };
    throw error;
  }

  const mediaMap = mapPhotoBank(record.photo_bank || recordLike.photo_bank);
  const donor = mapCategory(category, { facts, services: certifiedServices, files, manifest: donorManifest });

  const reviews = [...verifiedReviews(packet), ...depthReviews(facts)];
  const aggregate = verifiedAggregate(packet, reviews);
  const areas = depthAreas(facts);
  const areaSources = depthAreaSources(facts);
  const socials = verifiedSocials(facts);
  const badges = verifiedBadges(facts);
  const bookingUrl = httpsOrEmpty(facts.booking_url);
  const hours = depthHours(facts);

  const hero = mediaMap.hero;
  const servicePrefix = String(donorManifest.service_route_prefix || '');
  if (servicePrefix && !/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(servicePrefix)) throw new Error('spa_donor_service_prefix_invalid');
  const services = certifiedServices.map(service => ({
    name: service.name,
    shortLabel: donor.serviceShortLabels[service.name] || service.name,
    description: service.description,
    href: servicePrefix + '/' + slug(service.name),
    source: { file: service.file },
  }));

  const base = {
    schema: SCHEMA,
    identity: {
      businessName: facts.name,
      city: facts.city,
      state: facts.state,
      phoneDisplay: usPhoneDisplay(facts.phone),
      phoneTel: phoneTel(facts.phone),
      email: typeof facts.email === 'string' ? facts.email.trim() : '',
      website: facts.website,
      founded: Number.isSafeInteger(facts.founded) ? facts.founded : null,
      logoOnDark: options.verifiedLogo ? '/assets/client-logo.png' : '/assets/client-wordmark-dark.svg',
      logoOnLight: options.verifiedLogo ? '/assets/client-logo.png' : '/assets/client-wordmark-light.svg',
    },
    hero: {
      ...donor.heroText,
      poster: hero.path,
      video: options.heroVideo === true ? '/assets/hero-client-' + slug(category) + '.mp4' : '',
    },
    services,
    media: mediaMap.all.filter(x => x.status === 'assigned').map(item => ({
      role: item.role,
      path: item.path,
      sourceUrl: item.sourceUrl,
      sourceSha256: item.sourceSha256,
      outputSha256: item.sourceSha256,
      rank: item.rank,
      width: item.width,
      height: item.height,
      originalBytes: true,
    })),
    content: {
      serviceIntro: donor.serviceIntro,
      about: donor.about,
      seasonalNote: donor.seasonalNote,
      whyHeadline: donor.whyHeadline,
      ctaHeadline: donor.ctaHeadline,
      ctaBody: donor.ctaBody,
      values: donor.values,
      faqs: depthFaqs(facts),
    },
    trust: {
      reviews,
      aggregate,
      hours,
      areas,
      ...(areaSources.length ? { areaSources } : {}),
      socials,
      badges,
      stats: Number.isSafeInteger(facts.founded) ? [{ label: 'Founded', value: facts.founded }] : [],
      bookingUrl,
      mapUrl: '',
    },
    design: {
      paletteSource: 'approved-donor-fallback',
      accent: '',
      fonts: Array.isArray(donorManifest.visual?.fonts) ? donorManifest.visual.fonts : [],
    },
    trustModules: [],
    source: {
      category,
      prospectId: recordLike.prospect_id || record.prospect_id || 'unknown',
      compiledAt,
      packetSha256,
      packetVersion: packet.version,
      depthProvenance: 'source-bound-v1',
    },
  };

  // Client contract currently does not persist design-only CTA/heading strings outside content.
  // They are copied into values below only after strict normalization of all factual fields.
  const normalizedBase = normalizeClient({
    ...base,
    content: {
      serviceIntro: base.content.serviceIntro,
      about: base.content.about,
      seasonalNote: base.content.seasonalNote,
      whyHeadline: base.content.whyHeadline,
      ctaHeadline: base.content.ctaHeadline,
      ctaBody: base.content.ctaBody,
      values: base.content.values,
      faqs: base.content.faqs,
    },
  });

  const trustPlan = selectTrust(normalizedBase, donorManifest);
  return normalizeClient({ ...base, trustModules: trustPlan.ids });
}

module.exports = Object.freeze({
  toClientSiteData,
  slug,
  usPhoneDisplay,
  phoneTel,
  verifiedReviews,
  verifiedAggregate,
  verifiedBadges,
  verifiedAreas,
  verifiedSocials,
  depthReviews,
  depthHours,
  depthFaqs,
  depthAreas,
  depthAreaSources,
});
