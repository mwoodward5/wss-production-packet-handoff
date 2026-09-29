'use strict';
// Called only after the WSS Genie certificate validator. No generated claims.
function paragraph(markdown) {
  if (typeof markdown !== 'string') return '';
  return markdown.replace(/\r\n/g, '\n').trim().replace(/^#[^\n]*\n+/, '').split(/\n\n+/)[0].trim();
}
function mapDonor({ facts, services, files, manifest }) {
  if (facts?.category !== 'fencing' || manifest?.category !== 'fencing') throw new Error('donor_wrong_trade');
  for (const key of ['name', 'city', 'state', 'phone', 'website']) {
    if (typeof facts[key] !== 'string' || !facts[key].trim()) throw new Error('donor_identity_missing:' + key);
  }
  if (!Array.isArray(services) || !services.length || services.some(s => !s.name || !s.description)) throw new Error('donor_services_missing');
  if (!services.some(s => /\bfenc(?:e|es|ing)\b/i.test(s.name))) throw new Error('donor_wrong_trade');
  for (const service of services) {
    if (typeof service.file !== 'string' || !service.file.startsWith('content/services/')) throw new Error('fencing_service_copy_unbound');
    if (paragraph(files?.[service.file]) !== service.description) throw new Error('fencing_service_copy_unbound');
  }
  const home = paragraph(files?.['content/home.md']);
  const about = paragraph((files?.['content/about.md'] || files?.['content/home.md']));
  if (home.length < 20 || about.length < 20) throw new Error('donor_certified_copy_missing');
  // Service names are certified facts; do not synthesize quality or local claims.
  return {
    heroText: { line1: facts.name, emphasis: services[0].name, line3: facts.city + ', ' + facts.state, eyebrow: facts.name, support: home },
    serviceIntro: paragraph(files?.['content/services.md']) || services[0].description,
    about, whyHeadline: facts.name, values: [], seasonalNote: '',
    ctaHeadline: '', ctaBody: paragraph(files?.['content/contact.md']),
    serviceShortLabels: Object.fromEntries(services.map(s => [s.name, s.name])),
  };
}
module.exports = Object.freeze({ mapDonor });
