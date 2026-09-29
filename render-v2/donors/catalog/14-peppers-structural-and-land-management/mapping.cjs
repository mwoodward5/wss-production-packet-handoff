'use strict';
const {parseServiceMarkdown}=require('../../../contracts/genie-packet.cjs');
const allowed = new Set(['general contractor','general contracting','residential remodeling','remodeling','finish carpentry']);
function paragraph(body, key) {
  if (typeof body !== 'string') throw new Error('certified_copy_missing:' + key);
  const text = body.replace(/\r\n/g, '\n').replace(/^# [^\n]*\n+/, '').trim();
  if (text.length < 20) throw new Error('certified_copy_missing:' + key);
  return text;
}
// This is a local binding check, not packet certification. Keep the shared parser.
function assertServiceBinding(service, files) {
  if (typeof service.file !== 'string' || !/^content\/services\/[a-z0-9][a-z0-9_-]*\.md$/i.test(service.file) ||
      !Object.hasOwn(files, service.file) || typeof files[service.file] !== 'string') {
    throw new Error('service_file_unbound');
  }
  // Strip the heading/separator only; never trim, reflow, or normalize copy bytes.
  const body = files[service.file].replace(/^# [^\r\n]*(?:\r\n|\n)(?:[ \t]*(?:\r\n|\n))*/, '');
  const first = body.split(/\r?\n[ \t]*\r?\n/, 1)[0].replace(/\r?\n$/, '');
  if (first !== service.description) throw new Error('service_copy_mismatch');
  const parsed = parseServiceMarkdown(files[service.file], service.name);
  if (parsed.description !== service.description) throw new Error('service_copy_mismatch');
}
function mapDonor({ facts, services, files, manifest }) {
  if (!facts || !allowed.has(String(facts.category).toLowerCase()) || manifest?.category !== 'general contractor') throw new Error('donor_wrong_trade');
  for (const field of ['name','city','state','phone','website']) if (typeof facts[field] !== 'string' || !facts[field].trim()) throw new Error('identity_missing:' + field);
  if (!files || typeof files !== 'object' || Array.isArray(files) || !Array.isArray(services) || !services.length || services.some(s => !s || typeof s.name !== 'string' || !s.name.trim() || typeof s.description !== 'string' || !s.description.trim())) throw new Error('certified_services_missing');
  const trade = /\b(remodel(?:ing)?|renovat(?:ion|ing)|carpentry|contract(?:or|ing)|home additions?|decks?|porches|structural repair|kitchen|basement|greenhouses?)\b/i;
  if (!services.every(s => trade.test(s.name))) throw new Error('donor_wrong_trade');
  for (const service of services) assertServiceBinding(service, files);
  const home = paragraph(files?.['content/home.md'], 'home');
  const about = paragraph(files?.['content/about.md'], 'about');
  const intro = paragraph(files?.['content/services.md'], 'services');
  const headline = files['content/home.md'].split(/\r?\n/)[0].replace(/^#\s+/, '').trim();
  if (headline.length < 2 || headline.length > 80 || facts.name.length > 80) throw new Error('hero_copy_length');
  return Object.freeze({
    heroText: { line1: headline, emphasis: facts.name, line3: facts.city + ', ' + facts.state, eyebrow: facts.category, support: home.split(/\n\n+/)[0] },
    serviceIntro: intro, about, whyHeadline: '', values: [], seasonalNote: '', ctaHeadline: '', ctaBody: '',
    serviceShortLabels: Object.fromEntries(services.map(s => [s.name, s.name])),
  });
}
module.exports = Object.freeze({ mapDonor });
