'use strict';

// A private planning index. Source text remains in the archive and is never
// promoted to visitor copy by this module.
const POLICY = 'private_editorial_planning_only';
const EXCLUDED_ROUTE = /(?:^|\/)(?:dt_testimonials?|testimonials?|reviews?|demo|demos|sample|samples|example|examples|test|tests|wp-admin|wp-json|feed|tag|author|search)(?:\/|$)/i;
const BOILERPLATE_ROUTE = /(?:^|\/)(?:privacy-policy|privacy|terms(?:-and-conditions)?|cookie-policy|cookies|sitemap|cart|checkout|my-account|login)(?:\/|$)/i;
const WORDS = /\S+/g;

function normalizedHost(url) { return url.hostname.toLowerCase().replace(/^www\./, ''); }
function pathKind(path) {
  const value = path.toLowerCase();
  if (value === '/') return 'home';
  if (/(?:^|\/)(?:about|our-story|our-team|company)(?:\/|$)/.test(value)) return 'about';
  if (/(?:^|\/)(?:services?|hvac|air-conditioning|heating|refrigeration|repair|installation|maintenance)(?:\/|$)/.test(value)) return 'services';
  return 'other';
}

function buildSourceEditorialWorklist(archive = {}, primaryUrl = '') {
  const candidates = [], excluded = [];
  let base;
  try { base = new URL(primaryUrl); } catch { return { candidates, excluded, publicationPolicy: POLICY, error: 'invalid_primary_url' }; }
  if (!/^https?:$/.test(base.protocol) || base.username || base.password) {
    return { candidates, excluded, publicationPolicy: POLICY, error: 'invalid_primary_url' };
  }
  const seenHashes = new Set();
  const rows = Array.isArray(archive.pages) ? archive.pages : [];
  for (const page of rows) {
    if (!page || typeof page !== 'object') continue;
    const sourceUrl = String(page.sourceUrl || '');
    let url;
    try { url = new URL(sourceUrl); } catch { excluded.push({ sourceUrl, reason: 'invalid_source_url' }); continue; }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || normalizedHost(url) !== normalizedHost(base) || url.port !== base.port) {
      excluded.push({ sourceUrl, reason: 'outside_primary_domain' }); continue;
    }
    const route = String(page.route || url.pathname + url.search);
    if (EXCLUDED_ROUTE.test(url.pathname)) { excluded.push({ sourceUrl, reason: 'demo_or_testimonial_route' }); continue; }
    if (BOILERPLATE_ROUTE.test(url.pathname)) { excluded.push({ sourceUrl, reason: 'boilerplate_route' }); continue; }
    // Recompute against the actual archived text. Do not trust a caller's word
    // count or hash, which could make a thin source appear authoritative.
    const content = archive.files?.[page.file];
    if (typeof content !== 'string' || !content.trim()) { excluded.push({ sourceUrl, reason: 'missing_archive_text' }); continue; }
    const { createHash } = require('node:crypto');
    const sha256 = createHash('sha256').update(content).digest('hex');
    if (page.sha256 !== sha256) { excluded.push({ sourceUrl, reason: 'source_hash_mismatch' }); continue; }
    if (seenHashes.has(sha256)) { excluded.push({ sourceUrl, reason: 'duplicate_source_hash' }); continue; }
    seenHashes.add(sha256);
    candidates.push({ sourceUrl, route, file: page.file, sha256, words: (content.match(WORDS) || []).length,
      title: String(page.title || '').slice(0, 500), kind: pathKind(url.pathname),
      truncated: page.truncated === true, publicationPolicy: POLICY });
  }
  candidates.sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl));
  excluded.sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl));
  return { candidates, excluded, publicationPolicy: POLICY };
}

module.exports = { buildSourceEditorialWorklist };
