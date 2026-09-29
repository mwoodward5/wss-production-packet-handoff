'use strict';
function paragraph(markdown) {
  if (typeof markdown !== 'string') return '';
  return markdown.replace(/\r\n/g, '\n').split(/\n\s*\n/).map(s => s.trim()).find(s => s && !s.startsWith('#')) || '';
}
function boundParagraph(markdown) {
  if (typeof markdown !== 'string') return '';
  const first = markdown.split(/\r?\n[ \t]*\r?\n/).find(s => s.trim() && !s.trimStart().startsWith('#'));
  return first === undefined ? '' : first.replace(/\r?\n$/, '');
}
function mapDonor({ facts, services, files, manifest }) {
  if (!facts || !facts.name || !facts.city || !facts.state || !facts.phone || !facts.website) throw new Error('donor_identity_required');
  if (String(facts.category).trim().toLowerCase() !== 'tree service' || (manifest?.category && manifest.category !== 'tree service')) throw new Error('donor_wrong_trade');
  if (!Array.isArray(services) || !services.length || services.some(s => !s || typeof s.name !== 'string' || !s.name.trim() || typeof s.description !== 'string' || !s.description.trim())) throw new Error('donor_services_required');
  // Binding is not certification: upstream must still verify the source receipt.
  if (!files || typeof files !== 'object' || Array.isArray(files) || services.some(s =>
    typeof s.file !== 'string' || !/^content\/services\/[^/\\]+\.md$/.test(s.file) || s.file.includes('..') ||
    !Object.prototype.hasOwnProperty.call(files, s.file) || boundParagraph(files[s.file]) !== s.description
  )) throw new Error('donor_service_copy_unbound');
  const home = paragraph(files?.['content/home.md']);
  const about = paragraph(files?.['content/about.md']);
  if (home.length < 20 || about.length < 20) throw new Error('donor_certified_copy_required');
  const serviceIntro = paragraph(files?.['content/services.md']) || services.map(s => s.name).join(' / ');
  return Object.freeze({
    heroText: { line1: facts.name, emphasis: services[0].name, line3: facts.city, eyebrow: facts.city + ', ' + facts.state, support: home },
    serviceIntro, about, whyHeadline: '', values: [], seasonalNote: '', ctaHeadline: '', ctaBody: '',
    serviceShortLabels: Object.fromEntries(services.map(s => [s.name, s.name])),
  });
}
module.exports = Object.freeze({ mapDonor });
