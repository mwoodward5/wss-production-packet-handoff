 'use strict';
function paragraph(markdown) {
  return typeof markdown === 'string' ? markdown.replace(/\r\n/g, '\n').replace(/^\s*#{1,6}[^\n]*(?:\n|$)/, '').split(/\n\s*\n/).map(x => x.trim()).find(x => x && !x.startsWith('#')) || '' : '';
}
function mapDonor({ facts, services, files, manifest }) {
  if (!facts || !['name','city','state','phone','website'].every(k => typeof facts[k] === 'string' && facts[k].trim())) throw Error('concrete_identity_required');
  if (facts.category !== 'concrete' || manifest?.category !== 'concrete') throw Error('concrete_wrong_trade');
  if (!Array.isArray(services) || !services.length || services.length > 30 || services.some(s => !s || typeof s.name !== 'string' || s.name.trim().length < 2 || s.name.length > 48 || typeof s.description !== 'string' || s.description.trim().length < 20 || s.description.length > 1800)) throw Error('concrete_services_required');
  const home = paragraph(files?.['content/home.md']);
  const about = paragraph((files?.['content/about.md'] || files?.['content/home.md']));
  const serviceIntro = paragraph(files?.['content/services.md']) || home;
  const contact = paragraph(files?.['content/contact.md']);
  if (home.length < 20 || about.length < 20) throw Error('concrete_certified_copy_required');
  if (facts.name.length > 80 || (facts.city + ', ' + facts.state).length > 80) throw Error('concrete_hero_copy_too_long');
  if (home.length > 900 || about.length > 2400 || serviceIntro.length < 10 || serviceIntro.length > 800 || contact.length > 900) throw Error('concrete_certified_copy_length');
  return Object.freeze({
    heroText: { line1: facts.name, emphasis: services[0].name, line3: facts.city + ', ' + facts.state, eyebrow: facts.city + ', ' + facts.state, support: home },
    serviceIntro, about, whyHeadline: facts.name, values: [], seasonalNote: '',
    ctaHeadline: '', ctaBody: contact, serviceShortLabels: Object.fromEntries(services.map(s => [s.name, s.name])),
  });
}
module.exports = Object.freeze({ mapDonor });
