'use strict';

// Called after WSS validateRecord; this adapter does not certify raw inputs.
function paragraph(markdown, label) {
  if (typeof markdown !== 'string') throw new Error('electrical_copy_missing:' + label);
  const body = markdown.replace(/\r\n/g, '\n').trim().replace(/^#{1,6}[^\n]*\n+/, '');
  const copy = body.split(/\n\s*\n/)[0].trim();
  if (copy.length < 20) throw new Error('electrical_copy_missing:' + label);
  return copy;
}
function mapDonor({ facts, services, files, manifest } = {}) {
  if (facts?.category !== 'electrical' || manifest?.category !== 'electrical') throw new Error('electrical_wrong_trade');
  for (const key of ['name', 'city', 'state', 'phone', 'website']) {
    if (typeof facts[key] !== 'string' || !facts[key].trim()) throw new Error('electrical_identity_missing:' + key);
  }
  if (facts.services_source !== 'source_bound' || !Array.isArray(facts.services) || !Array.isArray(services) || !services.length) throw new Error('electrical_services_unbound');
  for (const service of services) {
    if (!facts.services.includes(service.name) || !service.file?.startsWith('content/services/')) throw new Error('electrical_service_unbound');
    const markdown = files?.[service.file];
    const heading = typeof markdown === 'string' ? markdown.trim().split(/\r?\n/)[0].replace(/^#+\s*/, '') : '';
    if (heading !== service.name || paragraph(markdown, service.file) !== service.description) throw new Error('electrical_service_copy_unbound');
  }
  const home = paragraph(files?.['content/home.md'], 'home');
  const about = paragraph((files?.['content/about.md'] || files?.['content/home.md']), 'about');
  // Identity and service labels are certified facts, not invented positioning.
  const heroText = { line1: facts.name, emphasis: services[0].name, line3: facts.city,
    eyebrow: [facts.city, facts.state].join(', '), support: home };
  if (home.length > 800 || about.length > 2400 || Object.values(heroText).slice(0, 3).some(x => x.length > 80)) throw new Error('electrical_copy_exceeds_contract');
  return Object.freeze({ heroText: Object.freeze(heroText), serviceIntro: home, about,
    whyHeadline: facts.name, values: Object.freeze([]), seasonalNote: '',
    ctaHeadline: facts.name, ctaBody: '',
    serviceShortLabels: Object.freeze(Object.fromEntries(services.map(s => {
      if (s.name.length > 48) throw new Error('electrical_service_label_exceeds_contract');
      return [s.name, s.name];
    }))),
  });
}
module.exports = Object.freeze({ mapDonor });
