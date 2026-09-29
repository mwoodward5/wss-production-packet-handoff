'use strict';
const { serviceKind } = require('./source/src/lib/service-kind.cjs');
// Inputs have already passed the copied Genie packet certification boundary.
function paragraph(markdown) {
  if (typeof markdown !== 'string') return '';
  const lines=markdown.replace(/\r\n/g, '\n').trim().split('\n');
  if(lines[0]?.startsWith('#'))lines.shift();
  return lines.join('\n').split(/\n\n+/).map(x => x.trim()).find(x => x && !x.startsWith('#')) || '';
}
function mapDonor({ facts, services, files, manifest } = {}) {
  if (!facts || !['electrical', 'electrician', 'residential electrical contracting'].includes(String(facts.category).toLowerCase())) throw new Error('electrical_trade_required');
  if (manifest && manifest.category !== 'electrical') throw new Error('donor_trade_mismatch');
  for (const key of ['name', 'city', 'state', 'phone', 'website']) if (typeof facts[key] !== 'string' || !facts[key].trim()) throw new Error('identity_required:' + key);
  if (!Array.isArray(services) || !services.length) throw new Error('certified_services_required');
  const home = paragraph(files?.['content/home.md']);
  if (home.length < 20) throw new Error('certified_home_copy_required');
  const about = paragraph((files?.['content/about.md'] || files?.['content/home.md']));
  if (about.length < 20) throw new Error('certified_about_copy_required');
  for (const service of services) {
    if (!serviceKind(service)) throw new Error('electrical_services_required');
    if (!service.name || typeof service.description !== 'string' || service.description.length < 20 || !service.file || !files?.[service.file]) throw new Error('certified_service_copy_required');
    const heading = files[service.file].trim().split(/\r?\n/)[0].replace(/^#+\s*/, '');
    if (heading.toLowerCase() !== service.name.toLowerCase() || paragraph(files[service.file]) !== service.description) throw new Error('certified_service_copy_mismatch');
  }
  // Keep the three-line rhythm using exact certified identity/service strings.
  return Object.freeze({
    heroText: { line1: facts.name, emphasis: services[0].name, line3: facts.city + ', ' + facts.state, eyebrow: facts.city + ', ' + facts.state, support: home },
    serviceIntro: paragraph(files?.['content/services.md']) || home,
    about,
    whyHeadline: '', values: [], seasonalNote: '', ctaHeadline: '', ctaBody: '',
    serviceShortLabels: Object.fromEntries(services.map(s => [s.name, s.name])),
  });
}
module.exports = Object.freeze({ mapDonor });
