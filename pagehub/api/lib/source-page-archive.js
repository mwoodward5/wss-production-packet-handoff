'use strict';
const { createHash } = require('node:crypto');
const MAX_ARCHIVE_BYTES = 48 * 1024 * 1024;
const MAX_PAGE_CHARS = 1024 * 1024;
const POLICY = 'private_source_reference_only_until_downstream_review';
function archiveSourcePages(packet = {}) {
  const files = {}; const pages = []; const excluded = [];
  const sources = packet.sources || {};
  const primary = packet.business?.domainUrl || sources.urls?.[0] || '';
  let base;
  try { base = new URL(primary); } catch { return { files, pages, excluded, bytes: 0, publicationPolicy: POLICY }; }
  const host = value => String(value).toLowerCase().replace(/^www\./, '');
  const rows = (Array.isArray(sources.observations) ? sources.observations : []).filter(row => row?.status === 'succeeded' && row.private_source);
  const byUrl = new Map();
  for (const row of rows) {
    try {
      const url = new URL(row.source);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || host(url.hostname) !== host(base.hostname) || url.port !== base.port) continue;
      url.protocol = base.protocol; url.host = base.host; url.hash = ''; url.searchParams.sort();
      url.pathname = url.pathname.replace(/\/+$/, '') || '/';
      if (!byUrl.has(url.href)) byUrl.set(url.href, { row, url });
    } catch { /* malformed observations cannot create content files */ }
  }
  let bytes = 0;
  for (const sourceUrl of [...byUrl.keys()].sort()) {
    const { row, url } = byUrl.get(sourceUrl);
    const raw = String(row.private_source.markdown || '');
    const text = raw.slice(0, MAX_PAGE_CHARS);
    if (!text.trim()) continue;
    const size = Buffer.byteLength(text, 'utf8');
    if (bytes + size > MAX_ARCHIVE_BYTES) { excluded.push({ sourceUrl, reason: 'archive_byte_budget' }); continue; }
    bytes += size;
    const digest = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 12);
    const slug = url.pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 100) || 'home';
    const file = 'content/source-pages/' + slug + '-' + digest + '.md';
    files[file] = text;
    pages.push({ sourceUrl, route: url.pathname + url.search, file,
      title: String(row.private_source.metadata?.title || row.private_source.metadata?.ogTitle || url.pathname).slice(0, 500),
      chars: text.length, words: (text.match(/\S+/g) || []).length,
      sha256: createHash('sha256').update(text).digest('hex'),
      truncated: row.private_source.markdown_truncated === true || raw.length > text.length,
      verificationStatus: 'source_observation_requires_review', publicationPolicy: POLICY });
  }
  return { files, pages, excluded, bytes, publicationPolicy: POLICY };
}
module.exports = { archiveSourcePages, MAX_ARCHIVE_BYTES, MAX_PAGE_CHARS };
