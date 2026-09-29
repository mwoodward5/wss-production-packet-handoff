'use strict';
const trades = new Set(['handyman', 'property maintenance', 'finish contracting']);
function paragraph(text) { return typeof text === 'string' ? text.replace(/\r\n/g,'\n').split(/\n\s*\n/).map(x=>x.trim()).find(x=>x && !x.startsWith('#')) || '' : ''; }
function mapDonor({facts, services, files, manifest}) {
  if (['name','city','state','phone'].some(key=>typeof facts?.[key] !== 'string' || !facts[key].trim())) throw Error('donor_identity_required');
  if (!trades.has(String(facts.category).toLowerCase()) || manifest?.category !== 'handyman') throw Error('donor_trade_mismatch');
  if (!Array.isArray(services) || !services.length || services.some(s=>!s || typeof s.name !== 'string' || !s.name.trim() || typeof s.description !== 'string' || s.description.trim().length < 20)) throw Error('donor_services_required');
  const home = paragraph(files?.['content/home.md']);
  const about = paragraph((files?.['content/about.md'] || files?.['content/home.md']));
  if (!home || !about) throw Error('donor_certified_copy_required');
  const serviceIntro = paragraph(files?.['content/services.md']) || services[0].description;
  return {heroText:{line1:services[0].name, emphasis:facts.name, line3:facts.city, eyebrow:facts.city+', '+facts.state,support:home},serviceIntro,about,whyHeadline:facts.name,values:[],seasonalNote:'',ctaHeadline:'',ctaBody:'',serviceShortLabels:Object.fromEntries(services.map(s=>[s.name,s.name]))};
}
module.exports={mapDonor};
