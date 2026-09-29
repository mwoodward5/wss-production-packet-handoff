'use strict';

// Inputs are the source-bound facts/services/files returned by validateRecord.
function paragraph(files, name) {
  const raw = files?.[name];
  if (typeof raw !== 'string') return '';
  return raw.replace(/\r\n/g, '\n').trim().replace(/^#{1,6}[^\n]*\n+/, '').trim().split(/\n\n+/)[0];
}
function mapDonor({ facts, services, files, manifest } = {}) {
  if (!facts || !['name', 'city', 'state', 'phone', 'website', 'category'].every(k => typeof facts[k] === 'string' && facts[k].trim())) throw new Error('automotive_identity_required');
  if (facts.category.trim().toLowerCase() !== 'auto repair' || manifest?.category !== 'auto repair') throw new Error('automotive_wrong_trade');
  if (!Array.isArray(services) || !services.length || services.some(s => !s.name || !s.description || !s.file || !files?.[s.file])) throw new Error('automotive_services_required');
  for (const service of services) {
    const lines = files[service.file].replace(/\r\n/g, '\n').trim().split('\n');
    if (lines[0].replace(/^#+\s*/, '').trim().toLowerCase() !== service.name.trim().toLowerCase() || paragraph(files, service.file) !== service.description) throw new Error('automotive_service_copy_unbound');
  }
  const home = paragraph(files, 'content/home.md');
  const about = paragraph(files, 'content/about.md');
  const intro = paragraph(files, 'content/services.md');
  const contact = paragraph(files, 'content/contact.md');
  if (home.length < 20 || about.length < 20) throw new Error('automotive_certified_copy_required');
  return Object.freeze({
    heroText: { line1: facts.name, emphasis: services[0].name, line3: facts.city + ', ' + facts.state, eyebrow: facts.city + ', ' + facts.state, support: home },
    serviceIntro: intro || services[0].description,
    about,
    whyHeadline: 'About ' + facts.name,
    values: [],
    seasonalNote: '',
    ctaHeadline: 'Contact ' + facts.name,
    ctaBody: contact,
    serviceShortLabels: Object.fromEntries(services.map(s => [s.name, s.name])),
  });
}
module.exports = Object.freeze({ mapDonor });
