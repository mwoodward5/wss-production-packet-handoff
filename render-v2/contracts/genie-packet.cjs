'use strict';

const crypto = require('node:crypto');
const SHA256 = /^[a-f0-9]{64}$/i;

function fail(code, path, detail) {
  const error = new Error(code);
  error.code = code;
  error.path = path;
  if (detail !== undefined) error.detail = detail;
  throw error;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

function packetHash(packet) {
  return crypto.createHash('sha256').update(Buffer.from(canonicalJson(packet), 'utf8')).digest('hex');
}

function certifiedVisitorFiles(packet) {
  const direct = packet?.content?.content_contract;
  const packet2 = packet?.packet2?.compiled?.contentContract;
  const contract = isObject(direct) ? direct : (isObject(packet2) ? packet2 : null);
  if (!contract || contract.schema !== 'CertifiedPracticePacket/v1' ||
      contract.kind !== 'certified_practice_packet' || contract.version !== 1 ||
      contract.builder_instructions?.public !== false) return {};
  const visitor = contract.visitor_copy;
  if (!isObject(visitor) || visitor.kind !== 'visitor_copy' || visitor.safety?.pass !== true ||
      !Array.isArray(visitor.safety?.violations) || visitor.safety.violations.length) return {};
  const files = visitor.files, hashes = visitor.file_hashes;
  if (!isObject(files) || !isObject(hashes)) return {};
  const paths = Object.keys(files).sort();
  if (!paths.length || canonicalJson(paths) !== canonicalJson(Object.keys(hashes).sort())) return {};
  const out = {};
  for (const p of paths) {
    const body = files[p], expected = String(hashes[p] || '');
    if (!p.startsWith('content/') || typeof body !== 'string' || !body.trim() || !SHA256.test(expected) ||
        crypto.createHash('sha256').update(body, 'utf8').digest('hex') !== expected) return {};
    out[p] = body;
  }
  return out;
}

function parseServiceMarkdown(markdown, expectedName) {
  if (typeof markdown !== 'string') fail('genie_service_copy_missing', '/content');
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');
  const heading = (lines[0] || '').replace(/^#+\s*/, '').trim();
  if (!heading) fail('genie_service_heading_missing', '/content');
  if (expectedName && heading.toLowerCase() !== expectedName.trim().toLowerCase()) {
    fail('genie_service_heading_mismatch', '/content', { expectedName, heading });
  }
  const description = lines.slice(1).join('\n').trim().split(/\n\n+/)[0].trim();
  if (description.length < 20) fail('genie_service_description_missing', '/content');
  return { heading, description };
}

function validateRecord(recordLike) {
  if (!isObject(recordLike)) fail('genie_record_required', '/');
  const record = isObject(recordLike.record) ? recordLike.record : recordLike;
  const packet = record.genie_canonical_packet;
  if (!isObject(packet)) fail('genie_packet_missing', '/record/genie_canonical_packet');
  if (packet.ok !== true || packet.status !== 'complete') fail('genie_packet_not_complete', '/record/genie_canonical_packet');
  if (packet.version !== 'intake-genie-v2') fail('genie_packet_version_unsupported', '/record/genie_canonical_packet/version', packet.version);

  const facts = packet.facts;
  if (!isObject(facts)) fail('genie_facts_missing', '/facts');
  for (const key of ['name','city','state','website','phone','category']) {
    if (typeof facts[key] !== 'string' || !facts[key].trim()) fail('genie_fact_missing', '/facts/' + key);
  }
  let website;
  try { website = new URL(facts.website); } catch { fail('genie_website_invalid', '/facts/website'); }
  if (website.protocol !== 'https:' || website.username || website.password) fail('genie_website_invalid', '/facts/website');

  if (!Array.isArray(facts.services) || !facts.services.length) fail('genie_services_missing', '/facts/services');
  if (facts.services_source !== 'source_bound') fail('genie_services_not_source_bound', '/facts/services_source', facts.services_source);

  const files = certifiedVisitorFiles(packet);
  if (!files['content/home.md']) fail('genie_home_copy_missing', '/content/content_contract/visitor_copy/files/content/home.md');

  const services = facts.services.map((name, index) => {
    if (typeof name !== 'string' || !name.trim()) fail('genie_service_name_invalid', '/facts/services/' + index);
    const candidates = Object.entries(files)
      .filter(([path]) => path.startsWith('content/services/'))
      .map(([path, body]) => ({ path, ...parseServiceMarkdown(body) }));
    const match = candidates.find(x => x.heading.toLowerCase() === name.trim().toLowerCase());
    if (match) return { name: name.trim(), description: match.description, file: match.path };
    const home = String(files['content/home.md'] || '').replace(/\r\n/g, '\n').trim();
    const homeBody = home.split('\n').slice(1).join('\n').trim().split(/\n\n+/)[0].trim();
    if (homeBody.length >= 20 && homeBody.toLowerCase().includes(name.trim().toLowerCase())) {
      return { name: name.trim(), description: homeBody, file: 'content/home.md' };
    }
    fail('genie_service_copy_unbound', '/facts/services/' + index, name);
  });

  const visitor = packet?.content?.content_contract?.visitor_copy;
  if (visitor?.safety && visitor.safety.pass === false) fail('genie_visitor_copy_safety_failed', '/content/content_contract/visitor_copy/safety');

  const compiledAt = record.genie_compiled_at || recordLike.compiled_at || packet?.transport_receipt?.compiled_at;
  if (typeof compiledAt !== 'string' || !compiledAt.trim()) fail('genie_compiled_at_missing', '/record/genie_compiled_at');

  return Object.freeze({
    packet,
    facts,
    files,
    services,
    compiledAt: compiledAt.trim(),
    packetSha256: packetHash(packet),
    record,
  });
}

module.exports = Object.freeze({
  validateRecord,
  packetHash,
  canonicalJson,
  certifiedVisitorFiles,
  parseServiceMarkdown,
  fail,
  SHA256,
});
