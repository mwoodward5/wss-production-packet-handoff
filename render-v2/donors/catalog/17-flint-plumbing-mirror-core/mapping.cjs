'use strict';

function paragraph(markdown) {
  if (typeof markdown !== 'string') return '';
  return markdown.replace(/\r\n/g, '\n').trim().split(/\n\n+/).filter(p => !/^#{1,6}\s/.test(p))[0]?.trim() || '';
}

// Inputs are certified by genie-packet.validateRecord before this adapter runs.
function mapDonor({ facts, services, files, manifest } = {}) {
  if (typeof facts?.category !== 'string' || facts.category.trim().toLowerCase() !== 'plumbing' || manifest?.category !== 'plumbing') throw new Error('donor_trade_mismatch');
  for (const key of ['name', 'city', 'state', 'phone', 'website']) {
    if (typeof facts[key] !== 'string' || !facts[key].trim()) throw new Error('donor_identity_missing:' + key);
  }
  if (!Array.isArray(services) || !services.length || services.some(s => !s || typeof s.name !== 'string' || !s.name.trim() || typeof s.description !== 'string' || s.description.trim().length < 20)) throw new Error('donor_services_missing');
  const home = paragraph(files?.['content/home.md']);
  if (home.length < 20) throw new Error('donor_home_copy_missing');
  const about = paragraph((files?.['content/about.md'] || files?.['content/home.md']));
  if (about.length < 20) throw new Error('donor_about_copy_missing');
  const intro = paragraph(files?.['content/services.md']) || services[0].description;
  return Object.freeze({
    heroText: { line1: facts.name, emphasis: services[0].name, line3: facts.city + ', ' + facts.state, eyebrow: facts.city + ', ' + facts.state, support: home },
    serviceIntro: intro, about, whyHeadline: facts.name,
    values: [], seasonalNote: '', ctaHeadline: facts.name,
    ctaBody: paragraph(files?.['content/contact.md']),
    serviceShortLabels: Object.fromEntries(services.map(s => [s.name, s.name])),
  });
}
module.exports = Object.freeze({ mapDonor });
