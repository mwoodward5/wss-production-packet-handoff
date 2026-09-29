'use strict';
// Adapter contract: WSS-CONTRACTS/adapters/genie-to-client.cjs.
const accepted = new Set(['concrete']);
// Keep the certified mapping's trade check aligned with this donor's runtime
// bridge. A source-observed generic heading can be valid packet content while
// still being incompatible with this particular donor.
const tradeService = /concrete|foundation|excavat|flatwork|driveway|demolition|renovat|remodel|flooring|construction|curbs?\b|retaining walls?\b/i;
function paragraph(text) {
  return typeof text === 'string' ? text.replace(/\r/g, '').split(/\n\s*\n/).map(x => x.trim()).find(x => x && !x.startsWith('#')) || '' : '';
}
function mapDonor({ facts, services, files, manifest }) {
  if (!facts || !['name','city','state','phone','website'].every(k => typeof facts[k] === 'string' && facts[k].trim())) throw Error('donor_identity_required');
  if (!accepted.has(facts.category?.trim().toLowerCase()) || (manifest?.category && manifest.category !== 'concrete')) throw Error('donor_wrong_trade');
  if (services?.some(s => !tradeService.test(String(s?.name || '')))) throw Error('donor_wrong_trade');
  if (!Array.isArray(services) || !services.length || services.some(s =>
    !s.name || typeof s.description !== 'string' || s.description.length < 20 ||
    !/^content\/services\/[a-z0-9][a-z0-9-]*\.md$/.test(s.file || '') ||
    paragraph(files?.[s.file]) !== s.description)) throw Error('donor_service_copy_unbound');
  const home = paragraph(files?.['content/home.md']);
  const about = paragraph((files?.['content/about.md'] || files?.['content/home.md']));
  if (home.length < 20 || about.length < 20) throw Error('donor_certified_copy_required');
  return Object.freeze({
    heroText: { line1: facts.name, emphasis: services[0].name, line3: facts.city + ', ' + facts.state, eyebrow: facts.city + ', ' + facts.state, support: home },
    serviceIntro: home, about, whyHeadline: facts.name, values: [], seasonalNote: '', ctaHeadline: '', ctaBody: '',
    serviceShortLabels: Object.fromEntries(services.map(s => [s.name, s.name])),
  });
}
module.exports = Object.freeze({ mapDonor });
