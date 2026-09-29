'use strict';
// CSD adapter shape: WSS-CONTRACTS/adapters/genie-to-client.cjs.
const trade = value => /^(flight training|flight school|aviation & flight training academy)$/i.test(String(value || '').trim());
function paragraph(markdown) {
  return String(markdown || '').replace(/\r\n/g, '\n').split(/\n\s*\n/).map(s => s.trim()).find(s => s && !s.startsWith('#')) || '';
}
function mapDonor({ facts, services, files, manifest }) {
  if (!trade(facts?.category) || (manifest?.category && !trade(manifest.category))) throw new Error('donor_trade_mismatch');
  for (const k of ['name', 'city', 'state', 'phone', 'website']) if (!String(facts?.[k] || '').trim()) throw new Error('donor_identity_missing:' + k);
  if (!Array.isArray(services) || !services.length || services.some(s => !s.name || !s.description)) throw new Error('donor_services_missing');
  const home = paragraph(files?.['content/home.md']);
  const about = paragraph((files?.['content/about.md'] || files?.['content/home.md']));
  if (home.length < 20 || about.length < 20) throw new Error('donor_certified_copy_missing');
  return Object.freeze({
    heroText: { line1: facts.name, emphasis: services[0].name, line3: facts.city + ', ' + facts.state, eyebrow: facts.name, support: home },
    serviceIntro: home, about, whyHeadline: facts.name,
    values: [], seasonalNote: '', ctaHeadline: '', ctaBody: '',
    serviceShortLabels: Object.fromEntries(services.map(s => [s.name, s.name])),
  });
}
module.exports = Object.freeze({ mapDonor, trade });
