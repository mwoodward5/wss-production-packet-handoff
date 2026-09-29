'use strict';

// Called only after the shared Genie packet validator certifies facts and files.
const CATEGORIES = new Set(['general contractor', 'general contracting', 'construction', 'residential construction', 'home builder', 'home building', 'remodeling', 'remodelling', 'home improvements', 'roofing', 'carpentry', 'concrete', 'flooring', 'tile', 'painting']);
const text = value => typeof value === 'string' ? value.trim() : '';
const category = value => text(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
function paragraph(markdown) {
  return text(markdown).replace(/\r\n/g, '\n').split(/\n\s*\n/).map(text).find(value => value && !/^#/.test(value)) || '';
}
function required(value, label, min = 1, max = 2400) {
  const result = text(value);
  if (result.length < min || result.length > max) throw new Error('construction_' + label + '_missing_or_invalid');
  return result;
}
function mapDonor({ facts, services, files, manifest } = {}) {
  if (!CATEGORIES.has(category(facts?.category)) || !CATEGORIES.has(category(manifest?.category))) throw new Error('construction_category_mismatch');
  const name = required(facts?.name, 'name', 2, 80);
  const city = required(facts?.city, 'city');
  const state = required(facts?.state, 'state', 2);
  required(facts?.phone, 'phone', 7);
  required(facts?.website, 'website', 8);
  if (!Array.isArray(services) || !services.length) throw new Error('construction_services_required');
  for (const service of services) {
    required(service?.name, 'service_name', 2, 48);
    required(service?.description, 'service_copy', 20, 1800);
    const file = text(service?.file);
    if (!file.startsWith('content/services/') || paragraph(files?.[file]) !== service.description.trim()) throw new Error('construction_service_copy_unbound');
  }
  const home = required(paragraph(files?.['content/home.md']), 'home_copy', 20, 800);
  const about = required(paragraph((files?.['content/about.md'] || files?.['content/home.md'])) || paragraph(facts?.copy), 'about_copy', 20);
  const location = required(city + ', ' + state, 'location', 2, 80);
  return Object.freeze({
    heroText: Object.freeze({ line1: name, emphasis: services[0].name, line3: location, eyebrow: location, support: home }),
    serviceIntro: home,
    about,
    whyHeadline: name,
    values: [],
    seasonalNote: '',
    ctaHeadline: '',
    ctaBody: '',
    serviceShortLabels: Object.freeze(Object.fromEntries(services.map(service => [service.name, service.name]))),
  });
}

module.exports = Object.freeze({ mapDonor });
