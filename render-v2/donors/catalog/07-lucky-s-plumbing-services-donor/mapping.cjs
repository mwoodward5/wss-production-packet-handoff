'use strict';
// Inputs are the certified facts/services/files returned by validateRecord.
const { parseServiceMarkdown } = require('../../../contracts/genie-packet.cjs');
function paragraph(markdown) {
  if (typeof markdown !== 'string') return '';
  return markdown.replace(/\r\n/g, '\n').trim().replace(/^#+[^\n]*\n+/, '').split(/\n\n+/)[0].trim();
}
function mapDonor({ facts, services, files, manifest } = {}) {
  if (facts?.category !== 'plumbing' || manifest?.category !== 'plumbing') throw new Error('donor_category_mismatch');
  for (const key of ['name', 'city', 'state', 'phone', 'website']) {
    if (typeof facts[key] !== 'string' || !facts[key].trim()) throw new Error('donor_identity_missing:' + key);
  }
  if (!Array.isArray(services) || !services.length || facts.services_source !== 'source_bound') throw new Error('donor_services_missing');
  for (const service of services) {
    if (!service.file?.startsWith('content/services/')) throw new Error('donor_service_unbound');
    const bound = parseServiceMarkdown(files?.[service.file], service.name);
    if (bound.description !== service.description || !facts.services?.includes(service.name)) throw new Error('donor_service_unbound');
  }
  const home = paragraph(files?.['content/home.md']);
  const about = paragraph((files?.['content/about.md'] || files?.['content/home.md']));
  if (home.length < 20 || about.length < 20) throw new Error('donor_certified_copy_missing');
  // Split only existing certified text/facts; no newly authored business claims.
  return Object.freeze({
    heroText: { line1: facts.name, emphasis: facts.city, line3: facts.state, eyebrow: facts.name, support: home },
    serviceIntro: home, about, whyHeadline: '', values: [], seasonalNote: '',
    ctaHeadline: facts.name, ctaBody: '',
    serviceShortLabels: Object.fromEntries(services.map(s => [s.name, s.name])),
  });
}
module.exports = Object.freeze({ mapDonor });
