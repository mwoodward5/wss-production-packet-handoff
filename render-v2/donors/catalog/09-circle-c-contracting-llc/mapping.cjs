'use strict';
const trade = /\b(excavat\w*|earthwork|earthmoving|trenching|grading|site prep\w*|land clearing|septic|water.*line|sewer|underground utilit\w*|drainage)\b/i;
function paragraph(text) {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map(s => s.trim()).find(s => s && !s.startsWith('#')) || '' : '';
}
function mapDonor({ facts, services, files, manifest }) {
  if (!facts?.name || !facts.city || !facts.state || !facts.phone || !facts.website) throw Error('donor_identity_required');
  if (facts.category !== 'excavation' || (manifest && manifest.category !== 'excavation')) throw Error('donor_wrong_trade');
  if (!Array.isArray(services) || !services.length || services.some(s => !trade.test(s.name) || typeof s.description !== 'string' || s.description.length < 20)) throw Error('donor_services_unsupported');
  // Donor binding only: certification remains the upstream Genie decision.
  if (!files || typeof files !== 'object' || Array.isArray(files) || services.some(s =>
    typeof s.file !== 'string' || !/^content\/services\/[^/\\]+\.md$/.test(s.file) || s.file.includes('..') ||
    !Object.hasOwn(files, s.file) || paragraph(files[s.file]) !== s.description
  )) throw Error('donor_service_copy_unbound');
  const support = paragraph(files?.['content/home.md']);
  const about = paragraph((files?.['content/about.md'] || files?.['content/home.md']));
  const serviceIntro = paragraph(files?.['content/services.md']) || services[0].description;
  if (support.length < 20 || about.length < 20) throw Error('donor_certified_copy_required');
  return Object.freeze({
    heroText: { line1: facts.name, emphasis: services[0].name, line3: facts.city + ', ' + facts.state, eyebrow: facts.city + ', ' + facts.state, support },
    serviceIntro, about, whyHeadline: facts.name, values: [], seasonalNote: '', ctaHeadline: '', ctaBody: '',
    serviceShortLabels: Object.fromEntries(services.map(s => [s.name, s.shortLabel || s.name])),
  });
}
module.exports = Object.freeze({ mapDonor, trade });
