'use strict';

// Called only after WSS certification; never mines prose for additional claims.
function paragraph(markdown) {
  if (typeof markdown !== 'string') return '';
  const lines = markdown.replace(/\r\n/g, '\n').trim().split('\n');
  if (/^#/.test(lines[0] || '')) lines.shift();
  return lines.join('\n').trim().split(/\n\n+/)[0].trim();
}

function mapDonor({ facts, services, files, manifest }) {
  if (!facts || !['name', 'city', 'state', 'phone', 'website'].every(k => typeof facts[k] === 'string' && facts[k].trim())) throw new Error('donor_identity_required');
  if (!['tree service', 'tree-service', 'tree_service', 'landscaping_tree_service'].includes(String(facts.category || '').toLowerCase())) throw new Error('donor_trade_mismatch');
  if (!Array.isArray(services) || !services.length || !services.every(s => typeof s.name === 'string' && s.name.length >= 2 && typeof s.description === 'string' && s.description.length >= 20)) throw new Error('donor_services_required');
  if (!services.every(s => typeof s.file === 'string' && s.file.startsWith('content/services/') && paragraph(files?.[s.file]) === s.description)) throw new Error('tree_service_service_copy_unbound');
  if (!services.some(s => /\b(tree|arborist|arboriculture|stump|pruning)\b/i.test(s.name))) throw new Error('donor_trade_mismatch');
  const home = paragraph(files?.['content/home.md']);
  const about = paragraph((files?.['content/about.md'] || files?.['content/home.md']));
  if (home.length < 20 || about.length < 20) throw new Error('donor_certified_copy_required');
  if (home.length > 800 || about.length > 2400 || services.some(s => s.name.length > 48)) throw new Error('donor_certified_copy_exceeds_slot');
  if ([facts.name, services[0].name, `${facts.city}, ${facts.state}`].some(x => x.length > 80)) throw new Error('donor_hero_copy_exceeds_slot');
  return Object.freeze({
    heroText: { line1: facts.name, emphasis: services[0].name, line3: `${facts.city}, ${facts.state}`, eyebrow: `${facts.city}, ${facts.state}`, support: home },
    serviceIntro: home,
    about,
    whyHeadline: '', values: [], seasonalNote: '', ctaHeadline: '', ctaBody: '',
    serviceShortLabels: Object.fromEntries(services.map(s => [s.name, s.name])),
  });
}

module.exports = Object.freeze({ mapDonor });
